const bcrypt = require('bcryptjs');

function seedDB(db) {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount > 0) return; // DB already seeded

    db.exec('BEGIN TRANSACTION');
    try {
        const insertUser = db.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
        const insertStudent = db.prepare('INSERT INTO students (user_id, reg_no, name, section, year, department) VALUES (?, ?, ?, ?, ?, ?)');
        const insertFaculty = db.prepare('INSERT INTO faculty (user_id, faculty_id, name, designation, department) VALUES (?, ?, ?, ?, ?)');

        // Admin
        insertUser.run('HOD001', bcrypt.hashSync('admin123', 10), 'admin', 'Mr.Amunchakravarthi');

        // Faculty
        const fac1 = insertUser.run('FAC001', bcrypt.hashSync('faculty123', 10), 'faculty', 'Mr. Saravanakumar').lastInsertRowid;
        const fac2 = insertUser.run('FAC002', bcrypt.hashSync('faculty123', 10), 'faculty', 'Mrs. Gomathi').lastInsertRowid;
        const fac3 = insertUser.run('FAC003', bcrypt.hashSync('faculty123', 10), 'faculty', 'Ms. Kaviyadharshini').lastInsertRowid;
        const fac4 = insertUser.run('FAC004', bcrypt.hashSync('faculty123', 10), 'faculty', 'Mr. Amunchakravarthi').lastInsertRowid;
        const fac5 = insertUser.run('FAC005', bcrypt.hashSync('faculty123', 10), 'faculty', 'Prof. James Wilson').lastInsertRowid;
        const fac6 = insertUser.run('FAC006', bcrypt.hashSync('faculty123', 10), 'faculty', 'Dr. Robert Chen').lastInsertRowid;
        const fac7 = insertUser.run('FAC007', bcrypt.hashSync('faculty123', 10), 'faculty', 'Ms. Emily Grant').lastInsertRowid;

        const f1_id = insertFaculty.run(fac1, 'FAC001', 'Mr. Saravanakumar', 'Assistant Professor', 'Data Science & AI').lastInsertRowid;
        const f2_id = insertFaculty.run(fac2, 'FAC002', 'Mrs. Gomathi', 'Assistant Professor', 'Data Science & AI').lastInsertRowid;
        const f3_id = insertFaculty.run(fac3, 'FAC003', 'Ms. Kaviyadharshini', 'Assistant Professor', 'Data Science & AI').lastInsertRowid;
        const f4_id = insertFaculty.run(fac4, 'FAC004', 'Mr. Amunchakravarthi', 'Assistant Professor', 'Data Science & AI').lastInsertRowid;
        const f5_id = insertFaculty.run(fac5, 'FAC005', 'Prof. James Wilson', 'Professor', 'Applied Sciences').lastInsertRowid;
        const f6_id = insertFaculty.run(fac6, 'FAC006', 'Dr. Robert Chen', 'Associate Professor', 'Applied Sciences').lastInsertRowid;
        const f7_id = insertFaculty.run(fac7, 'FAC007', 'Ms. Emily Grant', 'Assistant Professor', 'Applied Sciences').lastInsertRowid;

        // Students
        const studentsData = [
            ['20240982', 'Alex Johnson'],
            ['20CS001', 'Aaron Mitchell'],
            ['20CS002', 'Bianca Flores'],
            ['20CS003', 'Caleb Ross'],
            ['20CS004', 'David Park'],
            ['20CS005', 'Elena Petrova'],
            ['20248831', 'Robert Jameson'],
            ['20241102', 'Amrit Kaur'],
            ['20249045', 'Marcus Vance']
        ];

        const studentIds = [];
        for (const [username, name] of studentsData) {
            const uId = insertUser.run(username, bcrypt.hashSync('student123', 10), 'student', name).lastInsertRowid;
            const sId = insertStudent.run(uId, username, name, 'A', 3, 'Computer Science').lastInsertRowid;
            studentIds.push({ id: sId, name, username });
        }

        // Subjects
        const insertSubject = db.prepare('INSERT INTO subjects (code, name, faculty_id, section, year, department, target_attendance) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const sub1 = insertSubject.run('CS401', 'Algorithmic Analysis', f1_id, 'A', 3, 'Computer Science', 85).lastInsertRowid;
        const sub2 = insertSubject.run('CS302', 'Database Systems', f2_id, 'A', 3, 'Computer Science', 85).lastInsertRowid;
        const sub3 = insertSubject.run('CS415', 'Neural Networks', f3_id, 'A', 3, 'Computer Science', 85).lastInsertRowid;
        const sub4 = insertSubject.run('CS101', 'Intro to Computing', f4_id, 'A', 3, 'Computer Science', 85).lastInsertRowid;
        const sub5 = insertSubject.run('MATH201', 'Discrete Mathematics', f5_id, 'A', 3, 'Computer Science', 85).lastInsertRowid;
        const sub6 = insertSubject.run('PHYS102', 'Physics II', f6_id, 'A', 3, 'Computer Science', 85).lastInsertRowid;
        const sub7 = insertSubject.run('ENG105', 'Technical Writing', f7_id, 'A', 3, 'Computer Science', 85).lastInsertRowid;
        const subjects = [sub1, sub2, sub3, sub4, sub5, sub6, sub7];

        // Enrollments
        const insertEnrollment = db.prepare('INSERT INTO enrollments (student_id, subject_id) VALUES (?, ?)');
        for (const s of studentIds) {
            for (const sub of subjects) {
                insertEnrollment.run(s.id, sub);
            }
        }

        // Timetable (full week schedule)
        const insertTimetable = db.prepare('INSERT INTO timetable (subject_id, day_of_week, hour_number, start_time, end_time, room) VALUES (?, ?, ?, ?, ?, ?)');
        // Monday
        insertTimetable.run(sub1, 'Monday', 1, '09:00', '10:30', 'Room 101');
        insertTimetable.run(sub5, 'Monday', 2, '10:45', '12:15', 'Room 201');
        insertTimetable.run(sub6, 'Monday', 3, '14:00', '15:30', 'Room 301');
        // Tuesday
        insertTimetable.run(sub2, 'Tuesday', 1, '09:00', '10:30', 'Room 102');
        insertTimetable.run(sub3, 'Tuesday', 2, '10:45', '12:15', 'Room 202');
        insertTimetable.run(sub7, 'Tuesday', 3, '14:00', '15:30', 'Room 302');
        // Wednesday
        insertTimetable.run(sub1, 'Wednesday', 1, '09:00', '10:30', 'Room 101');
        insertTimetable.run(sub4, 'Wednesday', 2, '10:45', '12:15', 'Room 203');
        insertTimetable.run(sub6, 'Wednesday', 3, '14:00', '15:30', 'Room 301');
        // Thursday
        insertTimetable.run(sub2, 'Thursday', 1, '09:00', '10:30', 'Room 102');
        insertTimetable.run(sub5, 'Thursday', 2, '10:45', '12:15', 'Room 201');
        insertTimetable.run(sub7, 'Thursday', 3, '14:00', '15:30', 'Room 302');
        // Friday
        insertTimetable.run(sub3, 'Friday', 1, '09:00', '10:30', 'Room 202');
        insertTimetable.run(sub4, 'Friday', 2, '10:45', '12:15', 'Room 203');

        // Attendance (deterministic to match screenshot percentages)
        const insertAttendance = db.prepare('INSERT INTO attendance (student_id, subject_id, date, hour, status, marked_by) VALUES (?, ?, ?, ?, ?, ?)');
        const adminUser = db.prepare("SELECT id FROM users WHERE role='admin'").get().id;

        // Generate 25 weekday dates
        const dates = [];
        let d = new Date('2024-04-01');
        while (dates.length < 25) {
            if (d.getDay() !== 0 && d.getDay() !== 6) {
                dates.push(d.toISOString().split('T')[0]);
            }
            d.setDate(d.getDate() + 1);
        }

        // Alex Johnson attendance targets per subject (out of 25):
        // CS401: 24/25 = 96%, MATH201: 22/25 = 88%, PHYS102: 19/25 = 76%, ENG105: 23/25 = 92%
        // CS302: 24/25, CS415: 23/25, CS101: 24/25
        // Overall: (24+24+23+24+22+19+23)/175 = 159/175 = 90.8% ≈ 91%
        const alexTargets = {
            [sub1]: { present: 24, absent: 1 },  // CS401: 96%
            [sub2]: { present: 24, absent: 1 },  // CS302: 96%
            [sub3]: { present: 23, absent: 2 },  // CS415: 92%
            [sub4]: { present: 24, absent: 1 },  // CS101: 96%
            [sub5]: { present: 22, absent: 3 },  // MATH201: 88%
            [sub6]: { present: 19, absent: 6 },  // PHYS102: 76%
            [sub7]: { present: 23, absent: 2 },  // ENG105: 92%
        };

        // Shortage students attendance rates
        const shortageRates = {
            '20248831': 0.62,  // Robert Jameson - 62% CRITICAL
            '20241102': 0.68,  // Amrit Kaur - 68% WARNING
            '20249045': 0.71,  // Marcus Vance - 71% WARNING
        };

        for (let i = 0; i < dates.length; i++) {
            const dateStr = dates[i];

            for (const student of studentIds) {
                for (const subId of subjects) {
                    let status;

                    if (student.username === '20240982') {
                        // Alex: deterministic based on targets
                        const target = alexTargets[subId];
                        status = i < target.present ? 'P' : 'A';
                        // Add some Late entries for variety
                        if (status === 'P' && i === 3) status = 'L';
                        if (status === 'P' && i === 10) status = 'L';
                    } else if (shortageRates[student.username]) {
                        // Shortage students
                        status = i < Math.floor(shortageRates[student.username] * 25) ? 'P' : 'A';
                    } else {
                        // Normal students: ~90% attendance
                        status = i < 22 ? 'P' : (i < 23 ? 'L' : 'A');
                    }

                    insertAttendance.run(student.id, subId, dateStr, 1, status, adminUser);
                }
            }
        }

        // Assignments
        const insertAssignment = db.prepare('INSERT INTO assignments (subject_id, title, description, created_by) VALUES (?, ?, ?, ?)');
        const a1 = insertAssignment.run(sub2, 'Normalization Exercises', 'Lab Task 4 - Complete the normalization exercises for the given database schemas', f2_id).lastInsertRowid;
        const a2 = insertAssignment.run(sub1, 'Sorting Algorithm Analysis', 'Lab Task 3 - Compare time complexities of sorting algorithms', f1_id).lastInsertRowid;

        const insertAssTrack = db.prepare('INSERT INTO assignment_tracking (assignment_id, student_id, status) VALUES (?, ?, ?)');
        const aaron = studentIds.find(s => s.username === '20CS001');
        const bianca = studentIds.find(s => s.username === '20CS002');
        const caleb = studentIds.find(s => s.username === '20CS003');
        const david = studentIds.find(s => s.username === '20CS004');
        const elena = studentIds.find(s => s.username === '20CS005');

        // Lab Task 4 tracking
        insertAssTrack.run(a1, aaron.id, 'COMPLETED');
        insertAssTrack.run(a1, bianca.id, 'PENDING');
        insertAssTrack.run(a1, caleb.id, 'COMPLETED');
        insertAssTrack.run(a1, david.id, 'PENDING');
        if (elena) insertAssTrack.run(a1, elena.id, 'PENDING');

        // Lab Task 3 tracking
        insertAssTrack.run(a2, aaron.id, 'COMPLETED');
        insertAssTrack.run(a2, bianca.id, 'COMPLETED');
        insertAssTrack.run(a2, caleb.id, 'COMPLETED');
        insertAssTrack.run(a2, david.id, 'PENDING');
        if (elena) insertAssTrack.run(a2, elena.id, 'COMPLETED');

        // Leaves for Alex Johnson
        const insertLeave = db.prepare('INSERT INTO leaves (student_id, type, start_date, end_date, reason, status) VALUES (?, ?, ?, ?, ?, ?)');
        const alex = studentIds.find(s => s.username === '20240982');
        insertLeave.run(alex.id, 'Medical Leave (Sick)', '2024-03-12', '2024-03-14', 'High fever and doctor advised rest for 3 days', 'APPROVED');
        insertLeave.run(alex.id, 'Family Emergency', '2024-04-02', '2024-04-02', 'Urgent family matter requiring immediate attention', 'PENDING');

        db.exec('COMMIT');
        console.log('Database seeded successfully with demo data');
    } catch (error) {
        db.exec('ROLLBACK');
        console.error('Seed error:', error);
    }
}

module.exports = { seedDB };
const missingSubjects = [
  { code: 'AD3501', name: 'Deep Learning' },
  { code: 'CW3551', name: 'Data and Information Security' },
  { code: 'CS3551', name: 'Distributed Computing' },
  { code: 'CCS334', name: 'Big Data Analytics' },
  { code: 'CCW331', name: 'Business Analytics' },
  { code: 'CCS335', name: 'Cloud Computing' },
  { code: 'AD3511', name: 'Deep Learning Laboratory' },
  { code: 'MX3083', name: 'Film Appreciation' }
];

// Assuming your database instance is named 'db' inside seed.js:
const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO subjects (subject_code, subject_name) 
  VALUES (?, ?)
`);

missingSubjects.forEach(sub => {
  insertStmt.run(sub.code, sub.name);
});

console.log("Missing subjects seeded successfully!");
