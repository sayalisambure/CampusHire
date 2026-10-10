require("dotenv").config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 8000;

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'campushire-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 14400000 }
}));

const upload = multer({
    dest: path.join(__dirname, 'uploads'),
    limits: { fileSize: 5 * 1024 * 1024 }
});

const q = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('Database query failed:', err.message);
                return reject(err);
            }

            resolve(results);
        });
    });

const sid = uid =>
    q('SELECT student_id FROM student WHERE user_id=?', [uid])
        .then(rows => rows[0]?.student_id);

const cid = uid =>
    q('SELECT company_id FROM company WHERE user_id=?', [uid])
        .then(rows => rows[0]?.company_id);

const notify = (userId, title, message) =>
    q(
        'INSERT INTO notification(user_id,title,message) VALUES(?,?,?)',
        [userId, title, message]
    ).catch(err => console.error('Notification error:', err.message));

function role(requiredRole) {
    return (req, res, next) => {
        if (!req.session.user) return res.redirect('/login');

        if (req.session.user.role !== requiredRole) {
            return res.status(403).send('Unauthorized');
        }

        next();
    };
}

const student = role('STUDENT');
const faculty = role('FACULTY');
const company = role('COMPANY');

const roleAny = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

// HOME AND AUTHENTICATION

app.get('/', (req, res) => {
    res.render('home', { user: req.session.user });
});

app.get('/login', (req, res) => {
    res.render('login', { error: req.query.error });
});

app.post('/login', async (req, res) => {
    try {
        const users = await q(
            'SELECT * FROM users WHERE email=? AND password_hash=?',
            [req.body.email, req.body.password]
        );

        if (!users.length) {
            return res.redirect('/login?error=Invalid login');
        }

        req.session.user = users[0];

        if (users[0].role === 'STUDENT') {
            return res.redirect('/student');
        }

        if (users[0].role === 'FACULTY') {
            return res.redirect('/faculty');
        }

        return res.redirect('/company');
    } catch (err) {
        console.error(err);
        res.status(500).send('Login failed.');
    }
});

app.get('/register', async (req, res) => {
    try {
        res.render('register', {
            departments: await q('SELECT * FROM department'),
            error: req.query.error
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Registration page failed.');
    }
});

app.post('/register', async (req, res) => {
    try {
        const { x, email, password, department_id } = req.body;

        const user = await q(
            'INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,"STUDENT")',
            [x, email, password]
        );

        await q(
            'INSERT INTO student(user_id,department_id,first_name,graduation_year) VALUES(?,?,?,2028)',
            [user.insertId, department_id, x]
        );

        await notify(
            user.insertId,
            'Welcome to CampusHire',
            'Your student account was created successfully.'
        );

        res.redirect('/login?error=Registration successful');
    } catch (err) {
        console.error(err);
        res.redirect('/register?error=Email already exists');
    }
});

app.get('/company-register', (req, res) => {
    res.render('company_register', { error: req.query.error });
});

app.post('/company-register', async (req, res) => {
    try {
        const {
            company_name, email, password, industry, website, location
        } = req.body;

        const user = await q(
            'INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,"COMPANY")',
            [company_name, email, password]
        );

        await q(
            'INSERT INTO company(user_id,company_name,industry,website,location) VALUES(?,?,?,?,?)',
            [user.insertId, company_name, industry, website, location]
        );

        await notify(
            user.insertId,
            'Company Registration',
            'Your company account was created successfully.'
        );

        res.redirect('/login?error=Company registration successful');
    } catch (err) {
        console.error(err);
        res.redirect('/company-register?error=Email already exists');
    }
});

// STUDENT DASHBOARD

app.get('/student', student, async (req, res) => {
    try {
        const s = (await q(`
            SELECT s.*, u.name, u.email, d.department_name,
                   sa.tenth_percentage, sa.twelfth_percentage,
                   ar.cgpa, ar.backlogs
            FROM student s
            JOIN users u ON s.user_id=u.user_id
            JOIN department d ON s.department_id=d.department_id
            LEFT JOIN school_academic_record sa
                ON s.student_id=sa.student_id
            LEFT JOIN academic_record ar
                ON ar.student_id=s.student_id
                AND ar.semester=(
                    SELECT MAX(z.semester)
                    FROM academic_record z
                    WHERE z.student_id=s.student_id
                )
            WHERE s.user_id=?
        `, [req.session.user.user_id]))[0];

        if (!s) return res.status(404).send('Student profile not found.');

        const st = (await q(`
            SELECT
                (SELECT COUNT(*) FROM placement_drive
                 WHERE status='OPEN') available,
                (SELECT COUNT(*) FROM application
                 WHERE student_id=?) applied,
                (SELECT COUNT(*) FROM placement
                 WHERE student_id=?) placed
        `, [s.student_id, s.student_id]))[0];

        res.render('student', { s, st });
    } catch (err) {
        console.error(err);
        res.status(500).send('Dashboard failed to load.');
    }
});

// STUDENT PROFILE

app.get('/student/profile', student, async (req, res) => {
    try {
        const id = await sid(req.session.user.user_id);

        const s = (await q(`
            SELECT s.*, u.name, u.email, d.department_name,
                   sa.tenth_percentage, sa.twelfth_percentage,
                   ar.cgpa, ar.backlogs
            FROM student s
            JOIN users u ON s.user_id=u.user_id
            JOIN department d ON s.department_id=d.department_id
            LEFT JOIN school_academic_record sa
                ON s.student_id=sa.student_id
            LEFT JOIN academic_record ar
                ON ar.student_id=s.student_id
                AND ar.semester=(
                    SELECT MAX(z.semester)
                    FROM academic_record z
                    WHERE z.student_id=s.student_id
                )
            WHERE s.student_id=?
        `, [id]))[0];

        const skills = await q(`
            SELECT sk.skill_id, sk.skill_name, ss.proficiency_level
            FROM student_skill ss
            JOIN skill sk ON ss.skill_id=sk.skill_id
            WHERE ss.student_id=?
        `, [id]);

        const allskills = await q(
            'SELECT * FROM skill ORDER BY skill_name'
        );

        const resumes = await q(
            'SELECT * FROM resume WHERE student_id=? ORDER BY version DESC',
            [id]
        );

        res.render('profile', { s, skills, allskills, resumes });
    } catch (err) {
        console.error(err);
        res.status(500).send('Profile failed to load.');
    }
});

app.post('/student/profile', student, async (req, res) => {
    try {
        const id = await sid(req.session.user.user_id);
        const b = req.body;

        await q(
            'UPDATE student SET phone=?,graduation_year=? WHERE student_id=?',
            [b.phone, b.graduation_year, id]
        );

        await q(`
            INSERT INTO school_academic_record
                (student_id,tenth_percentage,twelfth_percentage)
            VALUES(?,?,?)
            ON DUPLICATE KEY UPDATE
                tenth_percentage=VALUES(tenth_percentage),
                twelfth_percentage=VALUES(twelfth_percentage)
        `, [id, b.tenth, b.twelfth]);

        const records = await q(
            'SELECT academic_id FROM academic_record WHERE student_id=? ORDER BY semester DESC LIMIT 1',
            [id]
        );

        if (records.length) {
            await q(
                'UPDATE academic_record SET cgpa=?,backlogs=? WHERE academic_id=?',
                [b.cgpa, b.backlogs || 0, records[0].academic_id]
            );
        } else {
            await q(
                'INSERT INTO academic_record(student_id,semester,cgpa,backlogs) VALUES(?,4,?,?)',
                [id, b.cgpa, b.backlogs || 0]
            );
        }

        await notify(
            req.session.user.user_id,
            'Profile Updated',
            'Your academic and profile details were updated.'
        );

        res.redirect('/student/profile');
    } catch (err) {
        console.error(err);
        res.status(500).send('Profile update failed.');
    }
});

app.post('/student/skills', student, async (req, res) => {
    try {
        const id = await sid(req.session.user.user_id);
        const chosen = [].concat(req.body.skills || []);

        await q('DELETE FROM student_skill WHERE student_id=?', [id]);

        for (const skillId of chosen) {
            await q(
                'INSERT INTO student_skill(student_id,skill_id,proficiency_level) VALUES(?,?,?)',
                [id, skillId, 'Basic']
            );
        }

        await notify(
            req.session.user.user_id,
            'Skills Updated',
            'Your skills were updated successfully.'
        );

        res.redirect('/student/profile');
    } catch (err) {
        console.error(err);
        res.status(500).send('Skills update failed.');
    }
});

app.post('/student/resume', student, async (req, res) => {
    try {
        const id = await sid(req.session.user.user_id);

        const row = (await q(
            'SELECT COALESCE(MAX(version),0) v FROM resume WHERE student_id=?',
            [id]
        ))[0];

        await q('UPDATE resume SET is_current=0 WHERE student_id=?', [id]);

        await q(
            'INSERT INTO resume(student_id,file_path,version) VALUES(?,?,?)',
            [id, req.body.url, row.v + 1]
        );

        await notify(
            req.session.user.user_id,
            'Resume Updated',
            'Your resume was updated successfully.'
        );

        res.redirect('/student/profile');
    } catch (err) {
        console.error(err);
        res.status(500).send('Resume update failed.');
    }
});

// PLACEMENT ELIGIBILITY

async function eligible(id, driveId) {
    const s = (await q(`
        SELECT s.department_id, s.graduation_year,
               COALESCE(ar.cgpa,0) cgpa,
               COALESCE(ar.backlogs,0) backlogs,
               COALESCE(sa.tenth_percentage,0) tenth,
               COALESCE(sa.twelfth_percentage,0) twelfth
        FROM student s
        LEFT JOIN academic_record ar
            ON ar.student_id=s.student_id
            AND ar.semester=(
                SELECT MAX(z.semester)
                FROM academic_record z
                WHERE z.student_id=s.student_id
            )
        LEFT JOIN school_academic_record sa
            ON sa.student_id=s.student_id
        WHERE s.student_id=?
    `, [id]))[0];

    const drive = (await q(`
        SELECT *
        FROM placement_drive pd
        JOIN eligibility_rule er ON pd.drive_id=er.drive_id
        WHERE pd.drive_id=?
    `, [driveId]))[0];

    if (!s || !drive) return [false, 'Drive not found'];

    const department = await q(
        'SELECT 1 FROM drive_department WHERE drive_id=? AND department_id=?',
        [driveId, s.department_id]
    );

    if (!department.length) {
        return [false, 'Department is not eligible'];
    }

    if (s.cgpa < drive.min_cgpa) {
        return [false, 'Minimum CGPA is ' + drive.min_cgpa];
    }

    if (s.tenth < drive.min_tenth_percentage) {
        return [false, 'Minimum 10th is ' + drive.min_tenth_percentage + '%'];
    }

    if (s.twelfth < drive.min_twelfth_percentage) {
        return [false, 'Minimum 12th is ' + drive.min_twelfth_percentage + '%'];
    }

    if (s.backlogs > drive.max_backlogs) {
        return [false, 'Maximum backlogs are ' + drive.max_backlogs];
    }

    return [true, 'Eligible'];
}

// PLACEMENT DRIVES

app.get('/drives', student, async (req, res) => {
    try {
        const id = await sid(req.session.user.user_id);

        const ds = await q(`
            SELECT pd.*, c.company_name, jr.role_name,
                   EXISTS(
                       SELECT 1 FROM application a
                       WHERE a.drive_id=pd.drive_id AND a.student_id=?
                   ) applied
            FROM placement_drive pd
            JOIN job_role jr ON pd.job_role_id=jr.job_role_id
            JOIN company c ON jr.company_id=c.company_id
            WHERE pd.status!='CLOSED'
            ORDER BY pd.drive_date
        `, [id]);

        for (const drive of ds) {
            drive.el = await eligible(id, drive.drive_id);
        }

        res.render('drives', { ds });
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not load placement drives.');
    }
});

app.get('/apply/:id', student, async (req, res) => {
    try {
        const id = await sid(req.session.user.user_id);

        const d = (await q(`
            SELECT pd.*, c.company_name, c.user_id company_user_id,
                   jr.role_name, er.*
            FROM placement_drive pd
            JOIN job_role jr ON pd.job_role_id=jr.job_role_id
            JOIN company c ON jr.company_id=c.company_id
            JOIN eligibility_rule er ON pd.drive_id=er.drive_id
            WHERE pd.drive_id=?
        `, [req.params.id]))[0];

        const skills = await q(`
            SELECT sk.skill_name
            FROM drive_skill ds
            JOIN skill sk ON ds.skill_id=sk.skill_id
            WHERE ds.drive_id=?
        `, [req.params.id]);

        const missing = await q(`
            SELECT sk.skill_name
            FROM drive_skill ds
            JOIN skill sk ON ds.skill_id=sk.skill_id
            LEFT JOIN student_skill ss
                ON ss.skill_id=ds.skill_id AND ss.student_id=?
            WHERE ds.drive_id=? AND ss.student_id IS NULL
        `, [id, req.params.id]);

        const el = await eligible(id, req.params.id);

        res.render('apply', { d, skills, missing, el });
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not load application page.');
    }
});

app.post('/apply/:id', student, async (req, res) => {
    try {
        const id = await sid(req.session.user.user_id);
        const el = await eligible(id, req.params.id);

        if (!el[0]) {
            return res.send('NOT ELIGIBLE: ' + el[1]);
        }

        await q(
            'INSERT INTO application(student_id,drive_id) VALUES(?,?)',
            [id, req.params.id]
        );

        await notify(
            req.session.user.user_id,
            'Application Submitted',
            'Your application was submitted successfully.'
        );

        const d = (await q(`
            SELECT c.user_id, c.company_name
            FROM placement_drive pd
            JOIN job_role jr ON pd.job_role_id=jr.job_role_id
            JOIN company c ON jr.company_id=c.company_id
            WHERE pd.drive_id=?
        `, [req.params.id]))[0];

        if (d) {
            await notify(
                d.user_id,
                'New Application',
                'A student has applied to your placement drive.'
            );
        }

        res.redirect('/applications');
    } catch (err) {
        console.error(err);
        res.send('Already applied or invalid application.');
    }
});

// APPLICATIONS AND NOTIFICATIONS

app.get('/applications', student, async (req, res) => {
    try {
        const id = await sid(req.session.user.user_id);

        const as = await q(`
            SELECT a.*, pd.drive_name, pd.package_lpa,
                   c.company_name, jr.role_name
            FROM application a
            JOIN placement_drive pd ON a.drive_id=pd.drive_id
            JOIN job_role jr ON pd.job_role_id=jr.job_role_id
            JOIN company c ON jr.company_id=c.company_id
            WHERE a.student_id=?
            ORDER BY a.applied_at DESC
        `, [id]);

        res.render('applications', { as });
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not load applications.');
    }
});

app.get('/notifications', roleAny, async (req, res) => {
    try {
        const ns = await q(
            'SELECT * FROM notification WHERE user_id=? ORDER BY created_at DESC',
            [req.session.user.user_id]
        );

        res.render('notifications', { ns });
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not load notifications.');
    }
});

app.post('/notifications/:id', roleAny, async (req, res) => {
    try {
        await q(
            'UPDATE notification SET is_read=1 WHERE notification_id=? AND user_id=?',
            [req.params.id, req.session.user.user_id]
        );

        res.redirect('/notifications');
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not update notification.');
    }
});

// AI RESUME ANALYZER

function analyzeResume(text, targetRole, skills) {
    text = (text || '').toLowerCase();
    targetRole = (targetRole || 'software developer').toLowerCase();

    const keywords = {
        'software developer': [
            'java', 'python', 'c++', 'javascript', 'sql',
            'git', 'dsa', 'oops', 'api', 'react', 'node.js', 'node'
        ],
        'frontend developer': [
            'html', 'css', 'javascript', 'react',
            'bootstrap', 'responsive', 'git', 'api'
        ],
        'backend developer': [
            'node.js', 'express', 'sql', 'mysql', 'mongodb',
            'api', 'git', 'authentication', 'javascript'
        ],
        'data analyst': [
            'python', 'sql', 'excel', 'pandas', 'numpy',
            'statistics', 'power bi', 'tableau'
        ],
        'data scientist': [
            'python', 'pandas', 'numpy', 'scikit-learn',
            'machine learning', 'statistics', 'sql', 'matplotlib'
        ]
    };

    const list = keywords[targetRole] || keywords['software developer'];

    const found = list.filter(k => text.includes(k));
    const missing = list.filter(k => !text.includes(k));

    const sections = [
        ['education', ['education', 'degree', 'b.tech', 'btech', 'cgpa']],
        ['projects', ['project', 'developed', 'built']],
        ['experience', ['internship', 'experience', 'intern']],
        ['skills', ['skills', 'technical skills']],
        ['achievements', ['achievement', 'hackathon', 'certification', 'certificate']]
    ];

    const missingSections = sections
        .filter(section => !section[1].some(k => text.includes(k)))
        .map(section => section[0]);

    const score = Math.min(
        100,
        35 +
        found.length * 7 +
        (text.length > 700 ? 15 : text.length > 350 ? 8 : 0) +
        (missingSections.length <= 1 ? 15 : missingSections.length === 2 ? 8 : 0)
    );

    const suggestions = [];

    if (text.length < 500) {
        suggestions.push(
            'Add more measurable detail. Aim for a concise 1-page resume with strong project and achievement bullets.'
        );
    }

    if (!text.includes('github')) {
        suggestions.push('Add your GitHub profile and relevant project repositories.');
    }

    if (!text.includes('linkedin')) {
        suggestions.push('Add your LinkedIn profile to improve recruiter discoverability.');
    }

    if (!text.includes('%') && !text.includes('cgpa')) {
        suggestions.push('Include academic performance such as CGPA or relevant percentages.');
    }

    if (!text.includes('project')) {
        suggestions.push('Add 2–3 relevant projects with your contribution, technologies and outcome.');
    }

    if (missing.length) {
        suggestions.push(
            'Add relevant keywords only when you genuinely have the skill: ' +
            missing.slice(0, 5).join(', ') + '.'
        );
    }

    if (!suggestions.length) {
        suggestions.push(
            'Your resume covers the main sections. Strengthen bullets with measurable results and clear technical contributions.'
        );
    }

    const courses = [];

    if (missing.includes('dsa')) courses.push('Data Structures & Algorithms');
    if (missing.includes('sql')) courses.push('SQL & Database Fundamentals');
    if (missing.includes('react')) courses.push('React and Frontend Development');

    if (missing.includes('node.js') || missing.includes('node')) {
        courses.push('Node.js and REST API Development');
    }

    if (missing.includes('git')) courses.push('Git and GitHub Fundamentals');
    if (missing.includes('machine learning')) {
        courses.push('Machine Learning Fundamentals');
    }

    if (!courses.length) {
        courses.push(
            'Advanced DSA for Coding Interviews',
            'System Design Fundamentals',
            'Resume and Technical Interview Preparation'
        );
    }

    return {
        score,
        found,
        missing,
        missingSections,
        suggestions,
        courses,
        targetRole
    };
}

// AI STUDENT CHATBOT

function botReply(message, skills) {
    const m = (message || '').toLowerCase();

    if (m.includes('resume') || m.includes('ats')) {
        return 'Use AI Career Assistant → Resume Analyzer. Paste your resume text and select your target role to get an ATS score, missing keywords, improvement suggestions and course recommendations.';
    }

    if (m.includes('drive') || m.includes('company')) {
        return 'Open Placement Drives to see available companies. Academic eligibility is checked automatically. Missing skills are shown as guidance, but skills do not block an application.';
    }

    if (m.includes('apply')) {
        return 'You can apply when the drive academic/department eligibility is satisfied. CampusHire prevents duplicate applications for the same drive.';
    }

    if (m.includes('interview') || m.includes('aptitude') || m.includes('technical')) {
        return 'For placement preparation, focus on DSA, SQL, OOP, core subjects, aptitude and project explanations. Track your application stage in My Applications.';
    }

    if (m.includes('skill')) {
        return 'Go to My Profile → Skills to add or remove skills. Your selected skills also help the Resume Analyzer identify useful keywords.';
    }

    if (m.includes('placement') || m.includes('selected')) {
        return 'Your placement status appears in My Placement after a placement record is created. Application updates are also shown in Notifications.';
    }

    if (m.includes('notification')) {
        return 'Open Notifications to see profile updates, skill updates, resume updates, application status changes and other placement updates.';
    }

    return 'I can help with resumes, ATS preparation, placement drives, applications, skills, interviews, notifications and placement status. Try asking: “How can I improve my resume?”';
}

// IMPORTANT: KEEP ONLY ONE COPY OF EACH AI ROUTE.

app.get('/student/ai', student, (req, res) => {
    res.render('ai', {
        resumeText: '',
        resumeUrl: '',
        result: null,
        chatQuestion: '',
        chatAnswer: ''
    });
});

app.post('/student/ai/analyze', student, async (req, res) => {
    try {
        const id = await sid(req.session.user.user_id);

        const skills = await q(`
            SELECT sk.skill_name
            FROM student_skill ss
            JOIN skill sk ON ss.skill_id=sk.skill_id
            WHERE ss.student_id=?
        `, [id]);

        const result = analyzeResume(
            req.body.resume_text,
            req.body.target_role,
            skills.map(x => x.skill_name)
        );

        res.render('ai', {
            skills: skills.map(x => x.skill_name),
            resumeUrl: req.body.resume_url || '',
            resumeText: req.body.resume_text || '',
            targetRole: req.body.target_role || '',
            result,
            chatQuestion: '',
            chatAnswer: ''
        });
    } catch (err) {
        console.error('Resume analysis error:', err);
        res.status(500).send('Resume analysis failed.');
    }
});

app.post('/student/ai/chat', student, (req, res) => {
    const question = req.body.message || '';
    const answer = botReply(question);

    res.render('ai', {
        resumeText: '',
        resumeUrl: '',
        result: null,
        chatQuestion: question,
        chatAnswer: answer
    });
});

// STUDENT PLACEMENT STATUS

app.get('/student/placement', student, async (req, res) => {
    try {
        const id = await sid(req.session.user.user_id);

        const p = (await q(`
            SELECT p.*, pd.package_lpa, pd.location,
                   c.company_name, jr.role_name
            FROM placement p
            JOIN placement_drive pd ON p.drive_id=pd.drive_id
            JOIN job_role jr ON pd.job_role_id=jr.job_role_id
            JOIN company c ON jr.company_id=c.company_id
            WHERE p.student_id=?
        `, [id]))[0];

        res.render('placement', { p });
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not load placement status.');
    }
});

// FACULTY DASHBOARD AND ADMIN PAGES

app.get('/faculty', faculty, async (req, res) => {
    try {
        const st = (await q(`
            SELECT
                (SELECT COUNT(*) FROM student) students,
                (SELECT COUNT(*) FROM company) companies,
                (SELECT COUNT(*) FROM placement_drive) drives,
                (SELECT COUNT(*) FROM application) applications,
                (SELECT COUNT(*) FROM placement) placements
        `))[0];

        res.render('faculty', { st });
    } catch (err) {
        console.error(err);
        res.status(500).send('Faculty dashboard failed.');
    }
});

app.get('/admin/students', faculty, async (req, res) => {
    try {
        const rows = await q(`
            SELECT u.name, u.email, d.department_name,
                   s.graduation_year, ar.cgpa, ar.backlogs
            FROM student s
            JOIN users u ON s.user_id=u.user_id
            JOIN department d ON s.department_id=d.department_id
            LEFT JOIN academic_record ar
                ON ar.student_id=s.student_id
                AND ar.semester=(
                    SELECT MAX(z.semester)
                    FROM academic_record z
                    WHERE z.student_id=s.student_id
                )
        `);

        res.render('admin_students', { rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not load students.');
    }
});

app.get('/admin/applications', faculty, async (req, res) => {
    try {
        const rows = await q(`
            SELECT a.*, u.name student_name,
                   c.company_name, pd.drive_name
            FROM application a
            JOIN student s ON a.student_id=s.student_id
            JOIN users u ON s.user_id=u.user_id
            JOIN placement_drive pd ON a.drive_id=pd.drive_id
            JOIN job_role jr ON pd.job_role_id=jr.job_role_id
            JOIN company c ON jr.company_id=c.company_id
            ORDER BY a.updated_at DESC
        `);

        res.render('admin_applications', { rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not load applications.');
    }
});

app.post('/admin/application/:id', faculty, async (req, res) => {
    try {
        const a = (await q(`
            SELECT a.*, s.user_id
            FROM application a
            JOIN student s ON a.student_id=s.student_id
            WHERE a.application_id=?
        `, [req.params.id]))[0];

        if (!a) return res.status(404).send('Application not found.');

        await q(
            'UPDATE application SET status=?,rejection_reason=? WHERE application_id=?',
            [req.body.status, req.body.reason || null, req.params.id]
        );

        if (req.body.status === 'SELECTED') {
            await q(
                'INSERT IGNORE INTO placement(student_id,drive_id) VALUES(?,?)',
                [a.student_id, a.drive_id]
            );
        }

        await notify(
            a.user_id,
            'Application Updated',
            'Status changed to ' + req.body.status +
            (req.body.reason ? ' | Reason: ' + req.body.reason : '')
        );

        const cu = (await q(`
            SELECT c.user_id
            FROM application a
            JOIN placement_drive pd ON a.drive_id=pd.drive_id
            JOIN job_role jr ON pd.job_role_id=jr.job_role_id
            JOIN company c ON jr.company_id=c.company_id
            WHERE a.application_id=?
        `, [req.params.id]))[0];

        if (cu) {
            await notify(
                cu.user_id,
                'Application Updated',
                'An application status was changed to ' + req.body.status + '.'
            );
        }

        res.redirect('/admin/applications');
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not update application.');
    }
});

// COMPANY DASHBOARD

app.get('/company', company, async (req, res) => {
    try {
        const id = await cid(req.session.user.user_id);

        const st = (await q(`
            SELECT COUNT(DISTINCT pd.drive_id) drives,
                   COUNT(a.application_id) applications
            FROM placement_drive pd
            JOIN job_role jr ON pd.job_role_id=jr.job_role_id
            LEFT JOIN application a ON pd.drive_id=a.drive_id
            WHERE jr.company_id=?
        `, [id]))[0];

        res.render('company', { st });
    } catch (err) {
        console.error(err);
        res.status(500).send('Company dashboard failed.');
    }
});

app.get('/company/drives', company, async (req, res) => {
    try {
        const id = await cid(req.session.user.user_id);

        const ds = await q(`
            SELECT pd.*, jr.role_name
            FROM placement_drive pd
            JOIN job_role jr ON pd.job_role_id=jr.job_role_id
            WHERE jr.company_id=?
        `, [id]);

        res.render('company_drives', { ds });
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not load company drives.');
    }
});

app.get('/company/create-drive', company, async (req, res) => {
    try {
        const deps = await q('SELECT * FROM department');
        const skills = await q('SELECT * FROM skill');

        res.render('create_drive', { deps, skills });
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not load drive form.');
    }
});

app.post('/company/create-drive', company, async (req, res) => {
    try {
        const id = await cid(req.session.user.user_id);
        const b = req.body;

        const j = await q(
            'INSERT INTO job_role(company_id,role_name) VALUES(?,?)',
            [id, b.role_name]
        );

        const d = await q(`
            INSERT INTO placement_drive
                (job_role_id,drive_name,package_lpa,location,
                 drive_date,application_deadline,status,description)
            VALUES(?,?,?,?,?,?,?,?)
        `, [
            j.insertId,
            b.drive_name,
            b.package_lpa,
            b.location,
            b.drive_date,
            b.deadline,
            b.status || 'OPEN',
            b.description
        ]);

        await q(`
            INSERT INTO eligibility_rule
                (drive_id,min_cgpa,max_backlogs,min_tenth_percentage,
                 min_twelfth_percentage,graduation_year)
            VALUES(?,?,?,?,?,2028)
        `, [
            d.insertId,
            b.min_cgpa || 0,
            b.max_backlogs || 0,
            b.min10 || 0,
            b.min12 || 0
        ]);

        const deps = [].concat(b.deps || []);
        const skills = [].concat(b.skills || []);

        for (const depId of deps) {
            await q(
                'INSERT INTO drive_department VALUES(?,?)',
                [d.insertId, depId]
            );
        }

        for (const skillId of skills) {
            await q(
                'INSERT INTO drive_skill VALUES(?,?,1)',
                [d.insertId, skillId]
            );
        }

        await notify(
            req.session.user.user_id,
            'Drive Created',
            'Your placement drive was created successfully.'
        );

        res.redirect('/company/drives');
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not create placement drive.');
    }
});

app.get('/company/applications', company, async (req, res) => {
    try {
        const id = await cid(req.session.user.user_id);

        const rows = await q(`
            SELECT a.*, u.name student_name, u.email, pd.drive_name
            FROM application a
            JOIN student s ON a.student_id=s.student_id
            JOIN users u ON s.user_id=u.user_id
            JOIN placement_drive pd ON a.drive_id=pd.drive_id
            JOIN job_role jr ON pd.job_role_id=jr.job_role_id
            WHERE jr.company_id=?
            ORDER BY a.updated_at DESC
        `, [id]);

        res.render('company_applications', { rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not load company applications.');
    }
});

app.post('/company/applications/bulk', company, async (req, res) => {
    try {
        const companyId = await cid(req.session.user.user_id);
        const ids = [].concat(req.body.application_ids || []).filter(Boolean);
        const status = req.body.status;
        const reason = req.body.reason || null;

        if (!ids.length) return res.redirect('/company/applications');

        if (!['SELECTED', 'REJECTED'].includes(status)) {
            return res.redirect('/company/applications');
        }

        for (const applicationId of ids) {
            const a = (await q(`
                SELECT a.application_id, a.student_id, a.drive_id, u.user_id
                FROM application a
                JOIN student s ON a.student_id=s.student_id
                JOIN users u ON s.user_id=u.user_id
                JOIN placement_drive pd ON a.drive_id=pd.drive_id
                JOIN job_role jr ON pd.job_role_id=jr.job_role_id
                WHERE a.application_id=? AND jr.company_id=?
            `, [applicationId, companyId]))[0];

            if (!a) continue;

            await q(
                'UPDATE application SET status=?,rejection_reason=? WHERE application_id=?',
                [status, status === 'REJECTED' ? reason : null, applicationId]
            );

            if (status === 'SELECTED') {
                await q(
                    'INSERT IGNORE INTO placement(student_id,drive_id) VALUES(?,?)',
                    [a.student_id, a.drive_id]
                );
            }

            await notify(
                a.user_id,
                'Application Updated',
                status === 'SELECTED'
                    ? 'Congratulations! Your application has been selected by the company.'
                    : 'Your application was rejected.' + (reason ? ' Reason: ' + reason : '')
            );
        }

        res.redirect('/company/applications');
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not update applications.');
    }
});

app.get('/company/students', company, async (req, res) => {
    try {
        const rows = await q(`
            SELECT u.name, u.email, d.department_name,
                   s.graduation_year, ar.cgpa, ar.backlogs
            FROM student s
            JOIN users u ON s.user_id=u.user_id
            JOIN department d ON s.department_id=d.department_id
            LEFT JOIN academic_record ar
                ON ar.student_id=s.student_id
                AND ar.semester=(
                    SELECT MAX(z.semester)
                    FROM academic_record z
                    WHERE z.student_id=s.student_id
                )
        `);

        res.render('company_students', { rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not load student records.');
    }
});

app.get('/company/students/export', company, async (req, res) => {
    try {
        const rows = await q(`
            SELECT u.name, u.email,
                   d.department_name department,
                   s.graduation_year, sa.tenth_percentage,
                   sa.twelfth_percentage, ar.cgpa, ar.backlogs
            FROM student s
            JOIN users u ON s.user_id=u.user_id
            JOIN department d ON s.department_id=d.department_id
            LEFT JOIN school_academic_record sa
                ON s.student_id=sa.student_id
            LEFT JOIN academic_record ar
                ON ar.student_id=s.student_id
                AND ar.semester=(
                    SELECT MAX(z.semester)
                    FROM academic_record z
                    WHERE z.student_id=s.student_id
                )
        `);

        const wb = XLSX.utils.book_new();

        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(rows),
            'Students'
        );

        res.attachment('campushire_students.xlsx');
        res.send(XLSX.write(wb, {
            type: 'buffer',
            bookType: 'xlsx'
        }));
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not export students.');
    }
});

// REPORTS

app.get('/reports', faculty, async (req, res) => {
    try {
        const st = (await q(`
            SELECT
                COUNT(DISTINCT s.student_id) students,
                COUNT(DISTINCT a.application_id) applications,
                COUNT(DISTINCT p.placement_id) placements,
                ROUND(
                    COUNT(DISTINCT p.placement_id) * 100 /
                    NULLIF(COUNT(DISTINCT s.student_id),0), 2
                ) percentage,
                ROUND(AVG(pd.package_lpa),2) avg_package,
                MAX(pd.package_lpa) max_package
            FROM student s
            LEFT JOIN application a ON s.student_id=a.student_id
            LEFT JOIN placement p ON s.student_id=p.student_id
            LEFT JOIN placement_drive pd ON p.drive_id=pd.drive_id
        `))[0];

        const by = await q(`
            SELECT c.company_name, COUNT(a.application_id) count
            FROM company c
            LEFT JOIN job_role jr ON c.company_id=jr.company_id
            LEFT JOIN placement_drive pd ON jr.job_role_id=pd.job_role_id
            LEFT JOIN application a ON pd.drive_id=a.drive_id
            GROUP BY c.company_id, c.company_name
        `);

        res.render('reports', { st, by });
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not load reports.');
    }
});

// LOGOUT AND SERVER

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

app.use((req, res) => {
    res.status(404).send('Page not found');
});

app.listen(PORT, () => {
    console.log('CampusHire running on http://localhost:' + PORT);
});
