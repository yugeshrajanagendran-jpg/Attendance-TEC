const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const exceljs = require('exceljs');

module.exports = function(db) {
    const router = express.Router();
    router.use(requireAuth, requireRole('faculty'));

    const getFacId = (userId) => {
        const fac = db.prepare('SELECT id FROM faculty WHERE user_id = ?').get(userId);
        return fac ? fac.id : null;
    };
    const ownsSubject = (userId, subjectId) => {
        const facultyId = getFacId(userId);
        return facultyId && db.prepare('SELECT id FROM subjects WHERE id = ? AND faculty_id = ?').get(subjectId, facultyId);
    };
    const requireOwnedSubject = (req, res, subjectId) => {
        if (!subjectId || !ownsSubject(req.session.user.id, subjectId)) {
            res.status(403).json({ error: 'You are not assigned to this subject' });
            return false;
        }
        return true;
    };

    router.get('/subjects', (req, res) => {
        try {
            const facId = getFacId(req.session.user.id);
            const subjects = db.prepare('SELECT * FROM subjects WHERE faculty_id = ?').all(facId);
            res.json(subjects);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/students', (req, res) => {
        try {
            const { subject_id } = req.query;
            if (!requireOwnedSubject(req, res, subject_id)) return;
            const students = db.prepare(`
                SELECT s.* FROM students s
                JOIN enrollments e ON e.student_id = s.id
                WHERE e.subject_id = ?
                ORDER BY s.reg_no ASC
            `).all(subject_id);
            res.json(students);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/attendance', (req, res) => {
        try {
            const { subject_id, date, hour } = req.query;
            if (!requireOwnedSubject(req, res, subject_id)) return;
            const records = db.prepare(`
                SELECT student_id, status FROM attendance
                WHERE subject_id = ? AND date = ? AND hour = ?
            `).all(subject_id, date, hour);
            res.json(records);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.post('/attendance', (req, res) => {
        try {
            const { subject_id, date, hour, records } = req.body;
            if (!subject_id || !date || !records) return res.status(400).json({ error: 'Missing data' });
            if (!Array.isArray(records) || !requireOwnedSubject(req, res, subject_id)) return;
            if (records.some(r => !Number(r.student_id) || !['P', 'A', 'L', 'OD', 'ML'].includes(r.status))) return res.status(400).json({ error: 'Invalid attendance records' });
            const enrolled = new Set(db.prepare('SELECT student_id FROM enrollments WHERE subject_id = ?').all(subject_id).map(row => row.student_id));
            if (records.some(r => !enrolled.has(Number(r.student_id)))) return res.status(400).json({ error: 'All students must be enrolled in this subject' });

            const insert = db.prepare(`
                INSERT INTO attendance (student_id, subject_id, date, hour, status, marked_by)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(student_id, subject_id, date, hour) DO UPDATE SET 
                status = excluded.status, modified_by = excluded.marked_by, modified_at = CURRENT_TIMESTAMP
            `);

            const transaction = db.transaction((recordsToInsert) => {
                for (const rec of recordsToInsert) {
                    insert.run(rec.student_id, subject_id, date, hour, rec.status, req.session.user.id);
                }
            });

            transaction(records);
            res.json({ message: 'Attendance saved successfully' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.post('/attendance/mark-all-present', (req, res) => {
        try {
            const { subject_id, date, hour } = req.body;
            if (!requireOwnedSubject(req, res, subject_id)) return;
            const students = db.prepare('SELECT student_id FROM enrollments WHERE subject_id = ?').all(subject_id);
            
            const insert = db.prepare(`
                INSERT INTO attendance (student_id, subject_id, date, hour, status, marked_by)
                VALUES (?, ?, ?, ?, 'P', ?)
                ON CONFLICT(student_id, subject_id, date, hour) DO UPDATE SET 
                status = 'P', modified_by = excluded.marked_by, modified_at = CURRENT_TIMESTAMP
            `);

            const transaction = db.transaction((st) => {
                for (const s of st) {
                    insert.run(s.student_id, subject_id, date, hour, req.session.user.id);
                }
            });

            transaction(students);
            res.json({ message: 'All students marked present' });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/export', async (req, res) => {
        try {
            const { subject_id, date, hour } = req.query;
            if (!requireOwnedSubject(req, res, subject_id)) return;
            const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(subject_id);
            const records = db.prepare(`
                SELECT st.reg_no, st.name as student_name, st.section, a.status, a.marked_at
                FROM attendance a
                JOIN students st ON a.student_id = st.id
                WHERE a.subject_id = ? AND a.date = ? AND a.hour = ?
                ORDER BY st.reg_no ASC
            `).all(subject_id, date, hour);

            const workbook = new exceljs.Workbook();
            const sheet = workbook.addWorksheet('Attendance');

            sheet.addRow([`Attendance Report - ${subject.name}`]).font = { bold: true, size: 16 };
            sheet.addRow([`Date: ${date}`, `Section: ${subject.section}`, `Hour: ${hour}`]);
            sheet.addRow([]);

            const headerRow = sheet.addRow(['Reg No', 'Student Name', 'Section', 'Status', 'Marked At']);
            headerRow.font = { bold: true };
            
            sheet.columns = [
                { key: 'reg_no', width: 15 },
                { key: 'student_name', width: 25 },
                { key: 'section', width: 10 },
                { key: 'status', width: 10 },
                { key: 'marked_at', width: 20 }
            ];

            let p=0, a=0, l=0;
            records.forEach(r => {
                const row = sheet.addRow([r.reg_no, r.student_name, r.section, r.status, r.marked_at]);
                const cell = row.getCell(4);
                if(r.status === 'P') { cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF00B050'}}; p++; }
                else if(r.status === 'A') { cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFFF0000'}}; a++; }
                else if(r.status === 'L') { cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFFFC000'}}; l++; }
                else if(r.status === 'OD') { cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF0070C0'}}; }
                else if(r.status === 'ML') { cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF7030A0'}}; }
                
                row.eachCell((c) => { c.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} }; });
            });

            sheet.addRow([]);
            const sumRow = sheet.addRow(['Total:', records.length, `P: ${p}`, `A: ${a}`, `L: ${l}`]);
            sumRow.font = { bold: true };

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="Attendance_${subject.code}_${date}.xlsx"`);
            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/assignments', (req, res) => {
        try {
            const { subject_id } = req.query;
            const assignments = db.prepare(`
                SELECT a.*, 
                    (SELECT COUNT(*) FROM assignment_tracking WHERE assignment_id = a.id AND status = 'COMPLETED') as completed_count,
                    (SELECT COUNT(*) FROM assignment_tracking WHERE assignment_id = a.id) as total_students
                FROM assignments a WHERE a.subject_id = ?
            `).all(subject_id);

            for (const assn of assignments) {
                assn.students = db.prepare(`
                    SELECT t.student_id, t.status, s.name as student_name
                    FROM assignment_tracking t
                    JOIN students s ON t.student_id = s.id
                    WHERE t.assignment_id = ?
                `).all(assn.id);
            }

            res.json(assignments);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.post('/assignments', (req, res) => {
        try {
            const { subject_id, title, description } = req.body;
            const facId = getFacId(req.session.user.id);
            if (!title || !requireOwnedSubject(req, res, subject_id)) return;
            
            const result = db.prepare('INSERT INTO assignments (subject_id, title, description, created_by) VALUES (?, ?, ?, ?)').run(subject_id, title, description, facId);
            const assignmentId = result.lastInsertRowid;
            const students = db.prepare('SELECT student_id FROM enrollments WHERE subject_id = ?').all(subject_id);
            
            const track = db.prepare('INSERT INTO assignment_tracking (assignment_id, student_id) VALUES (?, ?)');
            db.transaction((st) => {
                for (const s of st) {
                    track.run(assignmentId, s.student_id);
                }
            })(students);

            res.json({ message: 'Assignment created successfully' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.put('/assignments/:id/track', (req, res) => {
        try {
            const { student_id, status } = req.body;
            const assignment = db.prepare('SELECT subject_id FROM assignments WHERE id = ?').get(req.params.id);
            if (!assignment || !['PENDING', 'COMPLETED'].includes(status) || !requireOwnedSubject(req, res, assignment.subject_id)) return;
            db.prepare('UPDATE assignment_tracking SET status = ?, marked_by = ? WHERE assignment_id = ? AND student_id = ?')
              .run(status, req.session.user.id, req.params.id, student_id);
            res.json({ message: 'Status updated' });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.put('/assignments/:id/marks', (req, res) => {
        try {
            const { student_id, marks } = req.body;
            const assignment = db.prepare('SELECT subject_id FROM assignments WHERE id = ?').get(req.params.id);
            if (!assignment || !requireOwnedSubject(req, res, assignment.subject_id)) return;
            const numericMarks = Number(marks);
            if (!Number.isFinite(numericMarks) || numericMarks < 0) return res.status(400).json({ error: 'Marks must be a non-negative number' });
            db.prepare('UPDATE assignment_tracking SET marks = ?, marked_by = ?, marked_at = CURRENT_TIMESTAMP WHERE assignment_id = ? AND student_id = ?')
                .run(numericMarks, req.session.user.id, req.params.id, student_id);
            res.json({ message: 'Marks saved' });
        } catch (error) { res.status(500).json({ error: 'Server error' }); }
    });

    router.get('/assignments/:id/marks', (req, res) => {
        try {
            const assignment = db.prepare('SELECT subject_id FROM assignments WHERE id = ?').get(req.params.id);
            if (!assignment || !requireOwnedSubject(req, res, assignment.subject_id)) return;
            res.json(db.prepare(`SELECT t.student_id, st.reg_no, st.name, t.status, t.marks
                FROM assignment_tracking t JOIN students st ON st.id=t.student_id WHERE t.assignment_id=? ORDER BY st.reg_no`).all(req.params.id));
        } catch (error) { res.status(500).json({ error: 'Server error' }); }
    });

    router.put('/attendance/:id', (req, res) => {
        try {
            const { status } = req.body;
            const record = db.prepare('SELECT a.*, s.faculty_id FROM attendance a JOIN subjects s ON s.id=a.subject_id WHERE a.id=?').get(req.params.id);
            if (!record || !requireOwnedSubject(req, res, record.subject_id)) return;
            if (!['P', 'A', 'L', 'OD', 'ML'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
            const windowHours = Number((db.prepare("SELECT value FROM academic_config WHERE key='attendance_edit_window_hours'").get() || {}).value || 24);
            if ((Date.now() - new Date(record.marked_at + 'Z').getTime()) > windowHours * 3600000) return res.status(403).json({ error: 'Edit window has expired; submit a correction request' });
            db.prepare('UPDATE attendance SET status=?, modified_by=?, modified_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.session.user.id, record.id);
            res.json({ message: 'Attendance updated' });
        } catch (error) { res.status(500).json({ error: 'Server error' }); }
    });

    router.post('/attendance/correction', (req, res) => {
        try {
            const { attendance_id, new_status, reason } = req.body;
            const record = db.prepare('SELECT * FROM attendance WHERE id=?').get(attendance_id);
            if (!record || !requireOwnedSubject(req, res, record.subject_id)) return;
            if (!['P', 'A', 'L', 'OD', 'ML'].includes(new_status) || !reason) return res.status(400).json({ error: 'A valid status and reason are required' });
            db.prepare('INSERT INTO attendance_corrections (attendance_id, requested_by, old_status, new_status, reason) VALUES (?, ?, ?, ?, ?)')
                .run(record.id, req.session.user.id, record.status, new_status, reason);
            res.status(201).json({ message: 'Correction request submitted' });
        } catch (error) { res.status(500).json({ error: 'Server error' }); }
    });

    router.get('/today', (req, res) => {
        try {
            const facId = getFacId(req.session.user.id);
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const today = days[new Date().getDay()];
            
            const sessions = db.prepare(`
                SELECT t.*, s.name as subject_name
                FROM timetable t
                JOIN subjects s ON t.subject_id = s.id
                WHERE s.faculty_id = ? AND t.day_of_week = ?
            `).all(facId, today);

            const subjects = db.prepare('SELECT id, target_attendance FROM subjects WHERE faculty_id = ?').all(facId);
            let totalClasses = 0;
            let totalPresent = 0;
            let criticalCount = 0;

            for (const sub of subjects) {
                const enrolled = db.prepare('SELECT student_id FROM enrollments WHERE subject_id = ?').all(sub.id);
                for (const student of enrolled) {
                    const att = db.prepare(`
                        SELECT 
                            COUNT(*) as total,
                            COUNT(CASE WHEN status = 'P' OR status = 'OD' THEN 1 END) as present,
                            COUNT(CASE WHEN status = 'L' THEN 1 END) as late
                        FROM attendance 
                        WHERE student_id = ? AND subject_id = ?
                    `).get(student.student_id, sub.id);

                    const effectivePresent = att.present + (att.late * 0.5);
                    const pct = att.total > 0 ? (effectivePresent / att.total) * 100 : 100;
                    
                    totalClasses += att.total;
                    totalPresent += effectivePresent;

                    if (pct < (sub.target_attendance || 75)) {
                        criticalCount++;
                    }
                }
            }

            const avgAttendance = totalClasses > 0 ? Math.round((totalPresent / totalClasses) * 100) : 100;

            res.json({ 
                sessions: sessions.length, 
                avg_attendance: avgAttendance, 
                critical_absentees: criticalCount, 
                classes: sessions 
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/alerts', (req, res) => {
        try {
            const facId = getFacId(req.session.user.id);
            const subjects = db.prepare('SELECT id, name as subject_name, target_attendance FROM subjects WHERE faculty_id = ?').all(facId);
            
            const alerts = [];
            for (const sub of subjects) {
                const enrolled = db.prepare(`
                    SELECT s.id, s.name, s.reg_no, s.phone, s.email 
                    FROM students s
                    JOIN enrollments e ON e.student_id = s.id
                    WHERE e.subject_id = ?
                `).all(sub.id);

                for (const student of enrolled) {
                    const att = db.prepare(`
                        SELECT 
                            COUNT(*) as total,
                            COUNT(CASE WHEN status = 'P' OR status = 'OD' THEN 1 END) as present,
                            COUNT(CASE WHEN status = 'L' THEN 1 END) as late
                        FROM attendance 
                        WHERE student_id = ? AND subject_id = ?
                    `).get(student.id, sub.id);

                    const effectivePresent = att.present + (att.late * 0.5);
                    const pct = att.total > 0 ? (effectivePresent / att.total) * 100 : 100;
                    const target = sub.target_attendance || 75;

                    if (pct < target) {
                        alerts.push({
                            student_id: student.id,
                            reg_no: student.reg_no,
                            student_name: student.name,
                            phone: student.phone || '',
                            subject_id: sub.id,
                            subject_name: sub.subject_name,
                            percentage: pct.toFixed(1),
                            target: target,
                            total_classes: att.total,
                            present_classes: att.present
                        });
                    }
                }
            }
            res.json(alerts);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/timetable', (req, res) => {
        try {
            const facId = getFacId(req.session.user.id);
            const timetable = db.prepare(`
                SELECT t.*, s.name as subject_name, s.code 
                FROM timetable t JOIN subjects s ON t.subject_id = s.id
                WHERE s.faculty_id = ? ORDER BY t.day_of_week, t.hour_number
            `).all(facId);
            res.json(timetable);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    // WhatsApp Group Notification
    router.post('/whatsapp-notify', (req, res) => {
        try {
            const { subject_id } = req.body;
            const facId = getFacId(req.session.user.id);
            
            // Get subject info
            const subject = db.prepare('SELECT * FROM subjects WHERE id = ? AND faculty_id = ?').get(subject_id, facId);
            if (!subject) return res.status(404).json({ error: 'Subject not found' });
            
            // Get all enrolled students with their attendance
            const students = db.prepare(`
                SELECT s.id, s.name, s.reg_no FROM students s
                JOIN enrollments e ON e.student_id = s.id
                WHERE e.subject_id = ?
                ORDER BY s.reg_no ASC
            `).all(subject_id);
            
            const studentData = students.map(student => {
                const att = db.prepare(`
                    SELECT 
                        COUNT(*) as total,
                        COUNT(CASE WHEN status = 'P' OR status = 'OD' THEN 1 END) as present,
                        COUNT(CASE WHEN status = 'L' THEN 1 END) as late
                    FROM attendance WHERE student_id = ? AND subject_id = ?
                `).get(student.id, subject_id);
                
                const effective = att.present + (att.late * 0.5);
                const pct = att.total > 0 ? (effective / att.total) * 100 : 0;
                
                return {
                    name: student.name,
                    reg_no: student.reg_no,
                    percentage: pct.toFixed(1),
                    total_classes: att.total,
                    present: att.present
                };
            });
            
            // Build WhatsApp message
            const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            let message = `📊 *Attendance Report - ${subject.name} (${subject.code})*\n`;
            message += `📅 Date: ${today}\n`;
            message += `👨🏫 Faculty: ${req.session.user.name}\n`;
            message += `─────────────────\n`;
            
            studentData.forEach((s, i) => {
                const icon = parseFloat(s.percentage) >= 85 ? '✅' : (parseFloat(s.percentage) >= 75 ? '⚠️' : '🔴');
                message += `${i + 1}. ${s.name} (${s.reg_no})\n   ${icon} ${s.percentage}% (${s.present}/${s.total_classes} classes)\n`;
            });
            
            message += `─────────────────\n`;
            message += `Total Students: ${studentData.length}\n`;
            const belowTarget = studentData.filter(s => parseFloat(s.percentage) < 85).length;
            message += `⚠️ Below 85%: ${belowTarget} students\n`;
            message += `\n_Sent from Attendance @TEC_`;
            
            res.json({ 
                success: true, 
                message: message,
                whatsapp_url: `https://wa.me/?text=${encodeURIComponent(message)}`,
                student_count: studentData.length 
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
};
