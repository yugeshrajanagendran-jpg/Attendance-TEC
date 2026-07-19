const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const exceljs = require('exceljs');

module.exports = function(db) {
    const router = express.Router();
    router.use(requireAuth, requireRole('student'));

    // Helper to get student id
    const getStudentId = (userId) => {
        const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(userId);
        return student ? student.id : null;
    };

    router.get('/dashboard', (req, res) => {
        try {
            const studentId = getStudentId(req.session.user.id);
            if (!studentId) return res.status(404).json({ error: 'Student profile not found' });

            const stats = db.prepare(`
                SELECT 
                    COUNT(CASE WHEN status = 'P' THEN 1 END) as present,
                    COUNT(CASE WHEN status = 'A' THEN 1 END) as absent,
                    COUNT(CASE WHEN status = 'L' THEN 1 END) as late,
                    COUNT(*) as total
                FROM attendance WHERE student_id = ?
            `).get(studentId);

            stats.percentage = stats.total > 0 ? ((stats.present + (stats.late * 0.5)) / stats.total * 100).toFixed(2) : 0;
            res.json(stats);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/today', (req, res) => {
        try {
            const studentId = getStudentId(req.session.user.id);
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const today = days[new Date().getDay()];
            const dateStr = new Date().toISOString().split('T')[0];

            const schedule = db.prepare(`
                SELECT t.hour_number, t.start_time, t.end_time, t.room, s.name as subject_name,
                       (SELECT status FROM attendance WHERE student_id = ? AND subject_id = s.id AND date = ? AND hour = t.hour_number) as status
                FROM timetable t
                JOIN subjects s ON t.subject_id = s.id
                JOIN enrollments e ON e.subject_id = s.id
                WHERE e.student_id = ? AND t.day_of_week = ?
                ORDER BY t.hour_number ASC
            `).all(studentId, dateStr, studentId, today);

            res.json(schedule);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/subjects', (req, res) => {
        try {
            const studentId = getStudentId(req.session.user.id);
            const subjects = db.prepare(`
                SELECT s.id, s.code, s.name, s.target_attendance,
                    COUNT(a.id) as total_classes,
                    COUNT(CASE WHEN a.status = 'P' THEN 1 END) as present,
                    COUNT(CASE WHEN a.status = 'A' THEN 1 END) as absent
                FROM enrollments e
                JOIN subjects s ON e.subject_id = s.id
                LEFT JOIN attendance a ON a.subject_id = s.id AND a.student_id = e.student_id
                WHERE e.student_id = ?
                GROUP BY s.id
            `).all(studentId);

            const result = subjects.map(sub => ({
                ...sub,
                percentage: sub.total_classes > 0 ? ((sub.present / sub.total_classes) * 100).toFixed(2) : 0
            }));
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/leaves', (req, res) => {
        try {
            const studentId = getStudentId(req.session.user.id);
            const leaves = db.prepare('SELECT * FROM leaves WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
            const used = leaves.length;
            res.json({ leaves, available: Math.max(0, 15 - used), used });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.post('/leaves', (req, res) => {
        try {
            const studentId = getStudentId(req.session.user.id);
            const { type, start_date, end_date, reason } = req.body;
            if (!type || !start_date || !end_date) return res.status(400).json({ error: 'Missing required fields' });

            db.prepare('INSERT INTO leaves (student_id, type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)')
                .run(studentId, type, start_date, end_date, reason);
            res.json({ message: 'Leave request created successfully' });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/history', (req, res) => {
        try {
            const studentId = getStudentId(req.session.user.id);
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            const { status, subject_id } = req.query;

            let query = `
                SELECT a.date, a.status, s.name as subject_name, f.name as instructor_name
                FROM attendance a
                JOIN subjects s ON a.subject_id = s.id
                JOIN faculty f ON s.faculty_id = f.id
                WHERE a.student_id = ?
            `;
            const params = [studentId];

            if (status) { query += ' AND a.status = ?'; params.push(status); }
            if (subject_id) { query += ' AND a.subject_id = ?'; params.push(subject_id); }

            query += ' ORDER BY a.date DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const history = db.prepare(query).all(...params);
            res.json(history);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/export', async (req, res) => {
        try {
            const studentId = getStudentId(req.session.user.id);
            const history = db.prepare(`
                SELECT a.date, a.hour, s.code, s.name as subject, a.status
                FROM attendance a
                JOIN subjects s ON a.subject_id = s.id
                WHERE a.student_id = ?
                ORDER BY a.date DESC, a.hour ASC
            `).all(studentId);

            const workbook = new exceljs.Workbook();
            const sheet = workbook.addWorksheet('Attendance History');

            sheet.columns = [
                { header: 'Date', key: 'date', width: 15 },
                { header: 'Hour', key: 'hour', width: 10 },
                { header: 'Subject Code', key: 'code', width: 15 },
                { header: 'Subject', key: 'subject', width: 30 },
                { header: 'Status', key: 'status', width: 10 }
            ];

            sheet.getRow(1).font = { bold: true };

            history.forEach(row => {
                const sheetRow = sheet.addRow(row);
                const statusCell = sheetRow.getCell('status');
                if (row.status === 'P') { statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } }; }
                else if (row.status === 'A') { statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }; }
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="My_Attendance.xlsx"');
            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
};
