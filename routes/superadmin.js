const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('../middleware/auth');

const validRoles = new Set(['superadmin', 'admin', 'faculty', 'student']);
const validStatuses = new Set(['P', 'A', 'L', 'OD', 'ML']);

module.exports = function (db) {
    const router = express.Router();
    router.use(requireAuth, requireRole('superadmin'));

    const facultyForUser = (userId) => db.prepare('SELECT id FROM faculty WHERE user_id = ?').get(userId);
    const studentForUser = (userId) => db.prepare('SELECT id FROM students WHERE user_id = ?').get(userId);

    router.get('/dashboard', (req, res) => {
        const users = db.prepare('SELECT role, COUNT(*) AS count FROM users GROUP BY role').all();
        res.json({
            users: Object.fromEntries(users.map(row => [row.role, row.count])),
            departments: db.prepare('SELECT COUNT(*) AS count FROM departments').get().count,
            sections: db.prepare('SELECT COUNT(*) AS count FROM sections').get().count,
            recent_logins: db.prepare(`SELECT l.login_at, u.username, u.name, u.role FROM login_history l
                LEFT JOIN users u ON u.id = l.user_id ORDER BY l.login_at DESC LIMIT 10`).all()
        });
    });

    router.get('/users', (req, res) => {
        const { role, q = '' } = req.query;
        const where = ['(u.username LIKE ? OR u.name LIKE ?)'];
        const params = [`%${q}%`, `%${q}%`];
        if (role && validRoles.has(role)) { where.push('u.role = ?'); params.push(role); }
        res.json(db.prepare(`SELECT u.id, u.username, u.role, u.name, u.email, u.phone, u.created_at,
            f.faculty_id, s.reg_no FROM users u
            LEFT JOIN faculty f ON f.user_id = u.id LEFT JOIN students s ON s.user_id = u.id
            WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC`).all(...params));
    });

    router.post('/users', (req, res) => {
        const { username, password, role, name, email = null, phone = null, faculty_id, reg_no, department = 'Computer Science', section = 'A', year = 1 } = req.body;
        if (!username || !password || !name || !validRoles.has(role)) return res.status(400).json({ error: 'username, password, name and a valid role are required' });
        try {
            const create = db.transaction(() => {
                const userId = db.prepare('INSERT INTO users (username, password, role, name, email, phone) VALUES (?, ?, ?, ?, ?, ?)')
                    .run(String(username).trim(), bcrypt.hashSync(password, 12), role, String(name).trim(), email || null, phone || null).lastInsertRowid;
                if (role === 'faculty') db.prepare('INSERT INTO faculty (user_id, faculty_id, name, department, email) VALUES (?, ?, ?, ?, ?)')
                    .run(userId, faculty_id || username, name, department, email || null);
                if (role === 'student') db.prepare('INSERT INTO students (user_id, reg_no, name, section, year, department, email, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                    .run(userId, reg_no || username, name, section, Number(year) || 1, department, email || null, phone || null);
                return userId;
            });
            res.status(201).json({ id: create(), message: 'User created' });
        } catch (error) { res.status(400).json({ error: error.message }); }
    });

    router.put('/users/:id', (req, res) => {
        const id = Number(req.params.id); const { name, email, phone, password } = req.body;
        if (!id) return res.status(400).json({ error: 'Invalid user id' });
        try {
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
            if (!user) return res.status(404).json({ error: 'User not found' });
            db.transaction(() => {
                db.prepare('UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?').run(name ?? user.name, email ?? user.email, phone ?? user.phone, id);
                if (password) db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(password, 12), id);
                const fac = facultyForUser(id); if (fac) db.prepare('UPDATE faculty SET name = ?, email = ? WHERE id = ?').run(name ?? user.name, email ?? user.email, fac.id);
                const stu = studentForUser(id); if (stu) db.prepare('UPDATE students SET name = ?, email = ?, phone = ? WHERE id = ?').run(name ?? user.name, email ?? user.email, phone ?? user.phone, stu.id);
            })();
            res.json({ message: 'User updated' });
        } catch (error) { res.status(400).json({ error: error.message }); }
    });

    router.delete('/users/:id', (req, res) => {
        const id = Number(req.params.id);
        if (id === req.session.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
        try {
            db.transaction(() => {
                const student = studentForUser(id); const faculty = facultyForUser(id);
                if (student) db.prepare('DELETE FROM students WHERE id = ?').run(student.id);
                if (faculty) db.prepare('DELETE FROM faculty WHERE id = ?').run(faculty.id);
                const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
                if (!result.changes) throw new Error('User not found');
            })();
            res.json({ message: 'User deleted' });
        } catch (error) { res.status(400).json({ error: error.message }); }
    });

    router.get('/departments', (req, res) => res.json(db.prepare(`SELECT d.*, f.name AS hod_name FROM departments d LEFT JOIN faculty f ON f.id=d.hod_id ORDER BY d.name`).all()));
    router.post('/departments', (req, res) => {
        const { name, code, hod_id = null } = req.body;
        if (!name || !code) return res.status(400).json({ error: 'name and code are required' });
        try { res.status(201).json({ id: db.prepare('INSERT INTO departments (name, code, hod_id) VALUES (?, ?, ?)').run(name, code, hod_id).lastInsertRowid }); } catch (error) { res.status(400).json({ error: error.message }); }
    });
    router.put('/departments/:id', (req, res) => {
        const { name, code, hod_id = null } = req.body;
        try { db.prepare('UPDATE departments SET name=?, code=?, hod_id=? WHERE id=?').run(name, code, hod_id, req.params.id); res.json({ message: 'Department updated' }); } catch (error) { res.status(400).json({ error: error.message }); }
    });
    router.delete('/departments/:id', (req, res) => { try { db.prepare('DELETE FROM departments WHERE id=?').run(req.params.id); res.json({ message: 'Department deleted' }); } catch (error) { res.status(400).json({ error: error.message }); } });

    router.get('/sections', (req, res) => res.json(db.prepare(`SELECT s.*, d.name AS department_name, f.name AS advisor_name FROM sections s JOIN departments d ON d.id=s.department_id LEFT JOIN faculty f ON f.id=s.faculty_advisor_id ORDER BY d.name, s.year, s.name`).all()));
    router.post('/sections', (req, res) => {
        const { department_id, name, year, semester, faculty_advisor_id = null } = req.body;
        if (!department_id || !name || !year || !semester) return res.status(400).json({ error: 'department_id, name, year and semester are required' });
        try { res.status(201).json({ id: db.prepare('INSERT INTO sections (department_id,name,year,semester,faculty_advisor_id) VALUES (?,?,?,?,?)').run(department_id, name, year, semester, faculty_advisor_id).lastInsertRowid }); } catch (error) { res.status(400).json({ error: error.message }); }
    });
    router.put('/sections/:id', (req, res) => { const { name, year, semester, faculty_advisor_id = null } = req.body; try { db.prepare('UPDATE sections SET name=?,year=?,semester=?,faculty_advisor_id=? WHERE id=?').run(name,year,semester,faculty_advisor_id,req.params.id); res.json({ message: 'Section updated' }); } catch (error) { res.status(400).json({ error: error.message }); } });

    router.get('/academic-config', (req, res) => res.json(Object.fromEntries(db.prepare('SELECT key,value FROM academic_config').all().map(row => [row.key, row.value]))));
    router.put('/academic-config', (req, res) => { try { const update = db.prepare('INSERT INTO academic_config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'); db.transaction(() => Object.entries(req.body).forEach(([key,value]) => update.run(key, String(value))))(); res.json({ message: 'Configuration saved' }); } catch (error) { res.status(400).json({ error: error.message }); } });
    router.get('/login-history', (req, res) => { const limit = Math.min(Number(req.query.limit) || 50, 200); const offset = Math.max(Number(req.query.offset) || 0, 0); res.json(db.prepare(`SELECT l.*,u.username,u.name,u.role FROM login_history l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.login_at DESC LIMIT ? OFFSET ?`).all(limit, offset)); });
    router.get('/activity-logs', (req, res) => res.json(db.prepare(`SELECT a.date,a.hour,a.status,a.marked_at,u.name AS marked_by,s.name AS subject FROM attendance a LEFT JOIN users u ON u.id=a.marked_by JOIN subjects s ON s.id=a.subject_id ORDER BY a.marked_at DESC LIMIT 100`).all()));
    router.get('/reports/complete', (req, res) => res.json(db.prepare(`SELECT st.reg_no,st.name AS student_name,sub.code,sub.name AS subject,COUNT(a.id) AS total, SUM(CASE WHEN a.status IN ('P','OD') THEN 1 ELSE 0 END) + SUM(CASE WHEN a.status='L' THEN .5 ELSE 0 END) AS effective_present, ROUND(100.0*(SUM(CASE WHEN a.status IN ('P','OD') THEN 1 ELSE 0 END)+SUM(CASE WHEN a.status='L' THEN .5 ELSE 0 END))/NULLIF(COUNT(a.id),0),2) AS percentage FROM attendance a JOIN students st ON st.id=a.student_id JOIN subjects sub ON sub.id=a.subject_id GROUP BY st.id,sub.id ORDER BY st.reg_no,sub.code`).all()));

    // Explicit one-way sample reset: intended before entering institutional data.
    router.post('/clear-sample-data', (req, res) => {
        if (req.body.confirmation !== 'REMOVE SAMPLE DATA') return res.status(400).json({ error: 'Enter REMOVE SAMPLE DATA to confirm' });
        try { db.transaction(() => {
            for (const table of ['attendance_corrections','attendance','assignment_tracking','assignments','enrollments','timetable','leaves','notifications','sections','subjects']) db.prepare(`DELETE FROM ${table}`).run();
            db.prepare("DELETE FROM students").run(); db.prepare("DELETE FROM faculty").run();
            db.prepare("DELETE FROM users WHERE role <> 'superadmin'").run();
        })(); res.json({ message: 'Sample academic data removed. You can now add your institutional records.' }); } catch (error) { res.status(500).json({ error: error.message }); }
    });
    return router;
};
