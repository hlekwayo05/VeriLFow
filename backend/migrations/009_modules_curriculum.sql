-- Migration 009: modules reference table + application module_code

CREATE TABLE IF NOT EXISTS modules (
  code           VARCHAR(20) PRIMARY KEY,
  name           TEXT NOT NULL,
  course         programme_type NOT NULL,
  year_semester  VARCHAR(50) NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS module_code VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_applications_module_code ON applications (module_code);

-- DICT — Diploma in ICT
INSERT INTO modules (code, name, course, year_semester) VALUES
  ('COM100',  'Professional Communication 100', 'DICT', '1st Year — Semester 1'),
  ('DICT121', 'Computing Theory 121', 'DICT', '1st Year — Semester 1'),
  ('DICT131', 'Multimedia Fundamentals 131', 'DICT', '1st Year — Semester 1'),
  ('DICT151', 'Programming Fundamentals 151', 'DICT', '1st Year — Semester 1'),
  ('DICT111', 'Information Systems 111', 'DICT', '1st Year — Semester 1'),
  ('DICT112', 'Communication Network Fundamentals 112', 'DICT', '1st Year — Semester 2'),
  ('DICT122', 'Programming Fundamentals 122', 'DICT', '1st Year — Semester 2'),
  ('DICT132', 'Multimedia Fundamentals 132', 'DICT', '1st Year — Semester 2'),
  ('DICT142', 'Business Practice 142', 'DICT', '1st Year — Semester 2'),
  ('STAT101', 'Basic Statistics 101', 'DICT', '1st Year — Semester 2'),
  ('DICT211', 'Application Development 211', 'DICT', '2nd Year — Semester 1'),
  ('DICT221', 'Software Development 221', 'DICT', '2nd Year — Semester 1'),
  ('DICT231', 'IT Service Management 231', 'DICT', '2nd Year — Semester 1'),
  ('DICT241', 'Information Systems 241', 'DICT', '2nd Year — Semester 1'),
  ('DICT222', 'Application Development 222', 'DICT', '2nd Year — Semester 2'),
  ('DICT232', 'Communication Network 232', 'DICT', '2nd Year — Semester 2'),
  ('DICT242', 'Multimedia Applications 242', 'DICT', '2nd Year — Semester 2'),
  ('DICT252', 'IT Project Management 252', 'DICT', '2nd Year — Semester 2'),
  ('DICT311', 'Application Development 311', 'DICT', '3rd Year — Semester 1'),
  ('DICT321', 'Information Systems 321', 'DICT', '3rd Year — Semester 1'),
  ('DICT312', 'Application Development 312', 'DICT', '3rd Year — Semester 2'),
  ('DICT322', 'Information Systems 322', 'DICT', '3rd Year — Semester 2'),
  ('DICT300', 'Project 300', 'DICT', 'Year Block')
ON CONFLICT (code) DO NOTHING;

-- BICT — Bachelor of ICT
INSERT INTO modules (code, name, course, year_semester) VALUES
  ('ALP101',  'Academic Literacy and Professional Development for ICT 101', 'BICT', '1st Year — Semester 1'),
  ('DBF101',  'Introduction to Databases 101', 'BICT', '1st Year — Semester 1'),
  ('MFC101',  'Mathematics for Computing 101', 'BICT', '1st Year — Semester 1'),
  ('PRT101',  'Introduction to Programming Techniques 101', 'BICT', '1st Year — Semester 1'),
  ('CNT101',  'Introduction Communication Networking 101', 'BICT', '1st Year — Semester 1'),
  ('CPP102',  'Computing Professional Practice 102', 'BICT', '1st Year — Semester 2'),
  ('MFC102',  'Mathematics for Computing 102', 'BICT', '1st Year — Semester 2'),
  ('OSF102',  'Introduction to Operating Systems 102', 'BICT', '1st Year — Semester 2'),
  ('PRT102',  'Programming Techniques 102', 'BICT', '1st Year — Semester 2'),
  ('CNT102',  'Communication Networking 102', 'BICT', '1st Year — Semester 2'),
  ('PRT201',  'Programming Techniques 201', 'BICT', '2nd Year — Semester 1'),
  ('WDV201',  'Introduction to Web Development 201', 'BICT', '2nd Year — Semester 1'),
  ('PSE201',  'Principles of Software Engineering 201', 'BICT', '2nd Year — Semester 1'),
  ('DBS201',  'Database Systems 201', 'BICT', '2nd Year — Semester 1'),
  ('STF201',  'Statistics for Information Communication Technology 201', 'BICT', '2nd Year — Semester 1'),
  ('CYB202',  'Cybersecurity 202', 'BICT', '2nd Year — Semester 2'),
  ('MDT202',  'Mobile Application Development Techniques 202', 'BICT', '2nd Year — Semester 2'),
  ('IOT202',  'Introduction to the Internet of Things 202', 'BICT', '2nd Year — Semester 2'),
  ('DSA202',  'Data Structures and Algorithms 202', 'BICT', '2nd Year — Semester 2'),
  -- DSA202B is temporary — client to confirm correct code for Data Scalability and Analytics 202
  ('DSA202B', 'Data Scalability and Analytics 202', 'BICT', '2nd Year — Semester 2'),
  ('PRJ300',  'Project 300', 'BICT', '3rd Year — Semester 1'),
  ('IPM301',  'Information Technology Project Management 301', 'BICT', '3rd Year — Semester 1'),
  ('DAN301',  'Data Analytics 301', 'BICT', '3rd Year — Semester 1'),
  ('CYB302',  'Cybersecurity 302', 'BICT', '3rd Year — Semester 2'),
  ('PRG301',  'Programming Techniques 301', 'BICT', '3rd Year — Semester 2'),
  ('CNT302',  'Communication Networks 302', 'BICT', '3rd Year — Semester 2')
ON CONFLICT (code) DO NOTHING;
