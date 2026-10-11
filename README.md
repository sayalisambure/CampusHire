# CampusHire
Campus Placement & Recruitment Management System.

## Stack
Node.js + Express + EJS + MySQL + mysql2 + express-session + XLSX.

## Setup
1. Install Node.js and MySQL.
2. Open `database.js` and replace `YOUR_MYSQL_PASSWORD` with your MySQL root password.
3. In MySQL Workbench run `database/schema.sql`.
4. Run `database/seed.sql`.
5. Open terminal in this folder and run `npm install`.
6. Run `npm start`.
7. Open http://localhost:8000


## DBMS concepts
JOIN, GROUP BY, HAVING, COUNT, AVG, MAX, subquery and eligibility conditions are used in the backend.

## Important
Do not run two copies of Node at once. If port 8000 is busy, use `Ctrl+C` in the running server terminal or run `taskkill /F /IM node.exe` once.


## Recent features
- Students can update their skills from My Profile.
- Missing skills are displayed on a drive, but skills do not block applications.
- Companies can register themselves from the landing page.
- Notifications are created for important changes such as profile/skills/resume updates, applications, application status changes, and company drive creation.
