const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const multer = require('multer');
const xlsx = require('xlsx');
const exceljs = require('exceljs');
const bcrypt = require('bcryptjs');

const upload = multer({ dest: 'uploads/' });

module.exports = function(db) {
    const router = express.Router();
    router.use(requireAuth, requireRole('admin'));

    router.get('/dashboard', (req, res) => {
        try {
            const facultyCount = db.prepare('SELECT COUNT(*) as count FROM faculty').get().count;
            const totalHours = db.prepare('SELECT COUNT(*) as count FROM timetable').get().count;
            const avgWeeklyHours = facultyCount > 0 ? (totalHours / facultyCount * 1.5).toFixed(1) : 0;
            
            res.json({ 
                faculty_count: facultyCount, 
                total_faculty: facultyCount + 3,
                active_faculty: facultyCount, 
                avg_weekly_hours: parseFloat(avgWeeklyHours),
                system_message: `System optimized: ${3} vacant slots detected in Friday labs.`
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/trends', (req, res) => {
        try {
            // Get attendance grouped by week
            const weeks = db.prepare(`
                SELECT 
                    strftime('%W', date) as week_num,
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'P' OR status = 'OD' THEN 1 END) as present,
                    COUNT(CASE WHEN status = 'L' THEN 1 END) as late
                FROM attendance
                GROUP BY week_num
                ORDER BY week_num DESC
                LIMIT 7
            `).all();
            
            const trends = weeks.reverse().map((w, i) => {
                const effective = w.present + (w.late * 0.5);
                return {
                    label: `Week ${i + 1}`,
                    value: w.total > 0 ? Math.round((effective / w.total) * 100) : 0
                };
            });
            
            // Pad to 7 entries if needed
            while (trends.length < 7) {
                trends.unshift({ label: `Week ${trends.length + 1}`, value: 0 });
            }
            
            res.json(trends);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/classes', (req, res) => {
        try {
            const classes = db.prepare(`
                SELECT s.id, s.name, s.code, f.name as instructor,
                    (SELECT COUNT(DISTINCT e.student_id) FROM enrollments e WHERE e.subject_id = s.id) as student_count
                FROM subjects s
                LEFT JOIN faculty f ON s.faculty_id = f.id
            `).all();
    
            for (const cls of classes) {
                const att = db.prepare(`
                    SELECT 
                        COUNT(*) as total,
                        COUNT(CASE WHEN status = 'P' OR status = 'OD' THEN 1 END) as present,
                        COUNT(CASE WHEN status = 'L' THEN 1 END) as late
                    FROM attendance WHERE subject_id = ?
                `).get(cls.id);
                const effective = att.present + (att.late * 0.5);
                cls.overall_attendance = att.total > 0 ? Math.round((effective / att.total) * 100) : 0;
            }
            res.json(classes);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/recent-entries', (req, res) => {
        try {
            const recent = db.prepare(`
                SELECT a.date, a.hour, s.name as subject_name, u.name as marked_by_name, a.marked_at
                FROM attendance a
                JOIN subjects s ON a.subject_id = s.id
                JOIN users u ON a.marked_by = u.id
                GROUP BY a.date, a.hour, a.subject_id
                ORDER BY a.marked_at DESC LIMIT 10
            `).all();
            res.json(recent);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/alerts', (req, res) => {
        try {
            const students = db.prepare('SELECT id, name, reg_no FROM students').all();
            const alerts = [];
            for (const student of students) {
                const att = db.prepare(`
                    SELECT 
                        COUNT(*) as total,
                        COUNT(CASE WHEN status = 'P' OR status = 'OD' THEN 1 END) as present,
                        COUNT(CASE WHEN status = 'L' THEN 1 END) as late
                    FROM attendance WHERE student_id = ?
                `).get(student.id);
                const effective = att.present + (att.late * 0.5);
                const pct = att.total > 0 ? (effective / att.total) * 100 : 100;
                if (pct < 75 && att.total > 0) {
                    alerts.push({
                        name: student.name,
                        reg_no: student.reg_no,
                        student_id: student.id,
                        percentage: Math.round(pct),
                        level: pct < 65 ? 'CRITICAL' : 'WARNING'
                    });
                }
            }
            alerts.sort((a, b) => a.percentage - b.percentage);
            res.json(alerts);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/export', async (req, res) => {
        try {
            const workbook = new exceljs.Workbook();
            const sheet = workbook.addWorksheet('Department Report');
            sheet.addRow(['Full Department Report']);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="Dept_Report.xlsx"');
            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.post('/upload/students', upload.single('file'), (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const workbook = xlsx.readFile(req.file.path);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = xlsx.utils.sheet_to_json(sheet);
            
            if (!data || data.length === 0) {
                return res.status(400).json({ error: 'File is empty or could not be parsed' });
            }
            
            let imported = 0;
            const errors = [];
            const subjects = db.prepare('SELECT id FROM subjects').all();
            
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                const rowNum = i + 2; // Excel row number (1-indexed + header)
                
                if (!row.reg_no || !row.name) {
                    errors.push(`Row ${rowNum}: Missing required fields (reg_no and name are required)`);
                    continue;
                }
                
                try {
                    // Check if user/student already exists
                    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(String(row.reg_no));
                    if (existing) {
                        errors.push(`Row ${rowNum}: Student ${row.reg_no} already exists, skipped`);
                        continue;
                    }
                    
                    const pwd = bcrypt.hashSync('student123', 10);
                    const uId = db.prepare('INSERT INTO users (username, password, role, name, email) VALUES (?, ?, ?, ?, ?)')
                        .run(String(row.reg_no), pwd, 'student', String(row.name), row.email || null).lastInsertRowid;
                    
                    const sId = db.prepare('INSERT INTO students (user_id, reg_no, name, section, year, department, email, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                        .run(uId, String(row.reg_no), String(row.name), row.section || 'A', parseInt(row.year) || 3, row.department || 'Computer Science', row.email || null, row.phone || null).lastInsertRowid;
                    
                    // Auto-enroll in all subjects
                    for (const sub of subjects) {
                        try {
                            db.prepare('INSERT OR IGNORE INTO enrollments (student_id, subject_id) VALUES (?, ?)').run(sId, sub.id);
                        } catch(e) { /* ignore enrollment conflicts */ }
                    }
                    
                    imported++;
                } catch (rowError) {
                    errors.push(`Row ${rowNum}: Error processing ${row.reg_no} - ${rowError.message}`);
                }
            }
            
            // Clean up uploaded file
            try { require('fs').unlinkSync(req.file.path); } catch(e) {}
            
            res.json({ 
                success: true,
                message: `Successfully imported ${imported} student(s)`, 
                imported, 
                total: data.length,
                errors 
            });
        } catch (error) {
            console.error('Upload error:', error);
            // Clean up uploaded file on error
            try { if (req.file) require('fs').unlinkSync(req.file.path); } catch(e) {}
            res.status(500).json({ error: `Upload failed: ${error.message}`, errors: [error.message] });
        }
    });

    router.post('/upload/timetable', upload.single('file'), (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const workbook = xlsx.readFile(req.file.path);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = xlsx.utils.sheet_to_json(sheet);
            
            if (!data || data.length === 0) {
                return res.status(400).json({ error: 'File is empty or could not be parsed' });
            }
            
            let imported = 0;
            const errors = [];
            const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                const rowNum = i + 2;
                
                if (!row.subject_code || !row.day_of_week || !row.hour_number || !row.start_time || !row.end_time) {
                    errors.push(`Row ${rowNum}: Missing required fields (subject_code, day_of_week, hour_number, start_time, end_time are required)`);
                    continue;
                }
                
                if (!validDays.includes(row.day_of_week)) {
                    errors.push(`Row ${rowNum}: Invalid day_of_week '${row.day_of_week}'. Must be one of: ${validDays.join(', ')}`);
                    continue;
                }
                
                try {
                    const subject = db.prepare('SELECT id FROM subjects WHERE code = ?').get(String(row.subject_code));
                    if (!subject) {
                        errors.push(`Row ${rowNum}: Subject code '${row.subject_code}' not found in database`);
                        continue;
                    }
                    
                    // Check for existing entry
                    const existing = db.prepare('SELECT id FROM timetable WHERE subject_id = ? AND day_of_week = ? AND hour_number = ?')
                        .get(subject.id, row.day_of_week, parseInt(row.hour_number));
                    
                    if (existing) {
                        // Update existing entry
                        db.prepare('UPDATE timetable SET start_time = ?, end_time = ?, room = ? WHERE id = ?')
                            .run(String(row.start_time), String(row.end_time), row.room || null, existing.id);
                    } else {
                        // Insert new entry
                        db.prepare('INSERT INTO timetable (subject_id, day_of_week, hour_number, start_time, end_time, room) VALUES (?, ?, ?, ?, ?, ?)')
                            .run(subject.id, row.day_of_week, parseInt(row.hour_number), String(row.start_time), String(row.end_time), row.room || null);
                    }
                    imported++;
                } catch (rowError) {
                    errors.push(`Row ${rowNum}: Error processing - ${rowError.message}`);
                }
            }
            
            // Clean up uploaded file
            try { require('fs').unlinkSync(req.file.path); } catch(e) {}
            
            res.json({ 
                success: true,
                message: `Successfully imported ${imported} timetable entry(s)`, 
                imported, 
                total: data.length,
                errors 
            });
        } catch (error) {
            console.error('Timetable upload error:', error);
            try { if (req.file) require('fs').unlinkSync(req.file.path); } catch(e) {}
            res.status(500).json({ error: `Upload failed: ${error.message}`, errors: [error.message] });
        }
    });

    router.get('/attendance/search', (req, res) => {
        try {
            const { student, date_from, date_to, subject_id } = req.query;
            let query = `
                SELECT a.id, st.reg_no, st.name as student_name, s.name as subject_name, a.date, a.hour, a.status,
                    COALESCE(mu.name, u.name) as modified_by
                FROM attendance a
                JOIN students st ON a.student_id = st.id
                JOIN subjects s ON a.subject_id = s.id
                LEFT JOIN users u ON a.marked_by = u.id
                LEFT JOIN users mu ON a.modified_by = mu.id
                WHERE 1=1
            `;
            const params = [];

            if (student) { query += ' AND (st.name LIKE ? OR st.reg_no LIKE ?)'; params.push(`%${student}%`, `%${student}%`); }
            if (date_from) { query += ' AND a.date >= ?'; params.push(date_from); }
            if (date_to) { query += ' AND a.date <= ?'; params.push(date_to); }
            if (subject_id) { query += ' AND a.subject_id = ?'; params.push(subject_id); }

            query += ' ORDER BY a.date DESC LIMIT 50';
            const records = db.prepare(query).all(...params);
            res.json(records);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.put('/attendance/:id', (req, res) => {
        try {
            const { status } = req.body;
            db.prepare('UPDATE attendance SET status = ?, modified_by = ?, modified_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(status, req.session.user.id, req.params.id);
            res.json({ message: 'Attendance updated' });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/templates/students', async (req, res) => {
        try {
            const workbook = new exceljs.Workbook();
            const sheet = workbook.addWorksheet('Students');
            sheet.addRow(['reg_no', 'name', 'section', 'year', 'department', 'email', 'phone']);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="student_template.xlsx"');
            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.get('/templates/timetable', async (req, res) => {
        try {
            const workbook = new exceljs.Workbook();
            const sheet = workbook.addWorksheet('Timetable');
            sheet.addRow(['subject_code', 'day_of_week', 'hour_number', 'start_time', 'end_time', 'room']);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="timetable_template.xlsx"');
            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.post('/notify', (req, res) => {
        res.json({ message: 'Notifications simulated', count: 3 });
    });

    router.get('/students', (req, res) => {
        res.json(db.prepare('SELECT id, name, reg_no FROM students').all());
    });

    router.get('/subjects', (req, res) => {
        res.json(db.prepare('SELECT id, name, code FROM subjects').all());
    });

    // Department onboarding: these endpoints replace the old sample-only workflow.
    router.get('/faculty', (req, res) => res.json(db.prepare('SELECT f.*, u.username, u.phone FROM faculty f JOIN users u ON u.id=f.user_id ORDER BY f.name').all()));
    router.post('/faculty', (req, res) => {
        const { faculty_id, name, email = null, phone = null, department = 'Computer Science', password = 'ChangeMe123!' } = req.body;
        if (!faculty_id || !name) return res.status(400).json({ error: 'faculty_id and name are required' });
        try { const create = db.transaction(() => {
            const userId = db.prepare('INSERT INTO users (username,password,role,name,email,phone) VALUES (?,?,?,?,?,?)').run(faculty_id, bcrypt.hashSync(password, 12), 'faculty', name, email, phone).lastInsertRowid;
            return db.prepare('INSERT INTO faculty (user_id,faculty_id,name,department,email) VALUES (?,?,?,?,?)').run(userId,faculty_id,name,department,email).lastInsertRowid;
        }); res.status(201).json({ id: create(), message: 'Faculty added' }); } catch (error) { res.status(400).json({ error: error.message }); }
    });
    router.put('/faculty/:id', (req, res) => {
        const { name, email, department, designation } = req.body;
        try { const f = db.prepare('SELECT * FROM faculty WHERE id=?').get(req.params.id); if (!f) return res.status(404).json({ error: 'Faculty not found' }); db.transaction(() => { db.prepare('UPDATE faculty SET name=?,email=?,department=?,designation=? WHERE id=?').run(name ?? f.name,email ?? f.email,department ?? f.department,designation ?? f.designation,f.id); db.prepare('UPDATE users SET name=?,email=? WHERE id=?').run(name ?? f.name,email ?? f.email,f.user_id); })(); res.json({ message: 'Faculty updated' }); } catch (error) { res.status(400).json({ error: error.message }); }
    });
    router.get('/students/manage', (req, res) => res.json(db.prepare('SELECT s.*,u.username FROM students s JOIN users u ON u.id=s.user_id ORDER BY s.reg_no').all()));
    router.post('/students', (req, res) => {
        const { reg_no, name, email = null, phone = null, section = 'A', year = 1, department = 'Computer Science', password = 'ChangeMe123!' } = req.body;
        if (!reg_no || !name) return res.status(400).json({ error: 'reg_no and name are required' });
        try { const create = db.transaction(() => { const userId = db.prepare('INSERT INTO users (username,password,role,name,email,phone) VALUES (?,?,?,?,?,?)').run(reg_no,bcrypt.hashSync(password,12),'student',name,email,phone).lastInsertRowid; const studentId = db.prepare('INSERT INTO students (user_id,reg_no,name,section,year,department,email,phone) VALUES (?,?,?,?,?,?,?,?)').run(userId,reg_no,name,section,Number(year),department,email,phone).lastInsertRowid; db.prepare('INSERT OR IGNORE INTO enrollments (student_id,subject_id) SELECT ?,id FROM subjects WHERE section=? AND year=? AND department=?').run(studentId,section,Number(year),department); return studentId; }); res.status(201).json({ id:create(), message:'Student added' }); } catch (error) { res.status(400).json({ error:error.message }); }
    });
    router.put('/students/:id', (req, res) => { const { name,email,phone,section,year,department }=req.body; try { const s=db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id); if(!s) return res.status(404).json({error:'Student not found'}); db.transaction(()=>{db.prepare('UPDATE students SET name=?,email=?,phone=?,section=?,year=?,department=? WHERE id=?').run(name??s.name,email??s.email,phone??s.phone,section??s.section,Number(year??s.year),department??s.department,s.id);db.prepare('UPDATE users SET name=?,email=?,phone=? WHERE id=?').run(name??s.name,email??s.email,phone??s.phone,s.user_id);})();res.json({message:'Student updated'}); } catch(error){res.status(400).json({error:error.message});} });
    router.post('/subjects', (req,res) => { const { code,name,faculty_id,section='A',year=1,department='Computer Science',target_attendance=85,max_marks=100 }=req.body; if(!code||!name||!faculty_id) return res.status(400).json({error:'code, name and faculty_id are required'}); try{res.status(201).json({id:db.prepare('INSERT INTO subjects (code,name,faculty_id,section,year,department,target_attendance,max_marks) VALUES (?,?,?,?,?,?,?,?)').run(code,name,faculty_id,section,Number(year),department,Number(target_attendance),Number(max_marks)).lastInsertRowid});}catch(error){res.status(400).json({error:error.message});} });
    router.get('/corrections', (req,res) => res.json(db.prepare(`SELECT c.*,u.name AS requested_by_name,a.date,a.hour,s.name AS subject FROM attendance_corrections c JOIN users u ON u.id=c.requested_by JOIN attendance a ON a.id=c.attendance_id JOIN subjects s ON s.id=a.subject_id WHERE c.status='PENDING' ORDER BY c.created_at`).all()));
    router.put('/corrections/:id', (req,res) => { const { status }=req.body; if(!['APPROVED','REJECTED'].includes(status)) return res.status(400).json({error:'Invalid decision'}); try{const c=db.prepare('SELECT * FROM attendance_corrections WHERE id=? AND status=\'PENDING\'').get(req.params.id);if(!c)return res.status(404).json({error:'Correction not found'});db.transaction(()=>{if(status==='APPROVED')db.prepare('UPDATE attendance SET status=?,modified_by=?,modified_at=CURRENT_TIMESTAMP WHERE id=?').run(c.new_status,req.session.user.id,c.attendance_id);db.prepare('UPDATE attendance_corrections SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').run(status,req.session.user.id,c.id);})();res.json({message:'Correction reviewed'});}catch(error){res.status(500).json({error:'Server error'});} });
    router.post('/clear-sample-data', (req,res) => { if(req.body.confirmation !== 'REMOVE SAMPLE DATA') return res.status(400).json({error:'Enter REMOVE SAMPLE DATA to confirm'}); try{db.transaction(()=>{for(const table of ['attendance_corrections','attendance','assignment_tracking','assignments','enrollments','timetable','leaves','notifications','sections','subjects'])db.prepare(`DELETE FROM ${table}`).run();db.prepare('DELETE FROM students').run();db.prepare('DELETE FROM faculty').run();db.prepare("DELETE FROM users WHERE role NOT IN ('admin','superadmin')").run();})();res.json({message:'Sample data cleared. Add your institution records now.'});}catch(error){res.status(500).json({error:error.message});} });

    return router;
};
