'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const pool    = require('../db');
const { isApplicationsOpenFromDb } = require('./public');
const { validateRegister, validateLogin, validateChangePassword } = require('../validators/authValidator');
const { passwordErrorMessage } = require('../utils/passwordPolicy');

const BCRYPT_COST = 12;

function signAuthToken({
  userId,
  role,
  email,
  first_names,
  surname,
  applicationStatus = null,
  onboardingComplete = false,
  tempFlag = false,
}) {
  return jwt.sign(
    {
      userId,
      role,
      email:              email || null,
      first_names:        first_names || null,
      surname:            surname || null,
      applicationStatus,
      onboardingComplete: !!onboardingComplete,
      tempFlag:           !!tempFlag,
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}


router.post('/register', validateRegister, async (req, res) => {
  const {
    surname, title, initials, firstNames,
    email, cell, studentNumber, password, confirm,
  } = req.body;

  const errors = [];

  if (!surname       || surname.trim().length === 0) {
    errors.push({ field: 'surname', message: 'Surname is required.' });
  }
  if (!title         || title.trim().length === 0) {
    errors.push({ field: 'title', message: 'Title is required.' });
  }
  if (!initials      || initials.trim().length === 0) {
    errors.push({ field: 'initials', message: 'Initials are required.' });
  }
  if (!firstNames    || firstNames.trim().length === 0) {
    errors.push({ field: 'firstNames', message: 'First name(s) are required.' });
  }
  if (!email         || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    errors.push({ field: 'email', message: 'Please enter a valid email.' });
  } else if (!/@ump\.ac\.za$/i.test(String(email).trim())) {
    errors.push({ field: 'email', message: 'Use your student email ending in @ump.ac.za (e.g. 230383025@ump.ac.za).' });
  }
  if (!cell          || cell.trim().length < 9) {
    errors.push({ field: 'cell', message: 'Valid cell number is required.' });
  }
  if (!studentNumber || studentNumber.trim().length < 5) {
    errors.push({ field: 'studentNumber', message: 'Student number is required.' });
  }
  {
    const pwdMsg = passwordErrorMessage(password);
    if (pwdMsg) {
      errors.push({ field: 'password', message: pwdMsg });
    }
  }
  if (password !== confirm) {
    errors.push({ field: 'confirm', message: 'Passwords do not match.' });
  }

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  if (!(await isApplicationsOpenFromDb())) {
    return res.status(403).json({ errors: ['Applications are currently closed.'] });
  }

  try {
    const emailNorm   = email.toLowerCase().trim();
    const studentNorm = studentNumber.trim();

    const onStudentList = await pool.query(
      `SELECT id, student_number
       FROM students
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [emailNorm]
    );

    if (onStudentList.rows.length === 0) {
      return res.status(403).json({
        errors: [
          'This email is not on the eligible student list. Use the institutional email from the list uploaded by the FYE office, or contact them if you believe this is an error.',
        ],
      });
    }

    const listedStudentNo = (onStudentList.rows[0].student_number || '').trim();
    if (listedStudentNo && listedStudentNo !== studentNorm) {
      return res.status(400).json({
        errors: [
          'Your student number does not match the record for this email on the student list.',
        ],
      });
    }

    const existingEmail = await pool.query(
      `SELECT u.id, u.role, u.student_number,
              a.status AS app_status
       FROM users u
       LEFT JOIN applications a ON a.user_id = u.id
       WHERE u.email = $1`,
      [emailNorm]
    );

    if (existingEmail.rows.length > 0) {
      const existing = existingEmail.rows[0];

      // Allow re-submitting step 1 if they never finished the application
      if (existing.role === 'tutor' && existing.app_status === 'incomplete') {
        const studentConflict = await pool.query(
          'SELECT id FROM users WHERE student_number = $1 AND id != $2',
          [studentNorm, existing.id]
        );
        if (studentConflict.rows.length > 0) {
          return res.status(409).json({
            errors: ['This student number is already linked to another account.'],
          });
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
        await pool.query(
          `UPDATE users
           SET surname = $1, title = $2, initials = $3, first_names = $4,
               cell = $5, student_number = $6, password_hash = $7
           WHERE id = $8`,
          [
            surname.trim(),
            title.trim(),
            initials.trim(),
            firstNames.trim(),
            cell.trim(),
            studentNorm,
            passwordHash,
            existing.id,
          ]
        );

        const token = signAuthToken({
          userId: existing.id,
          role: 'tutor',
          email: emailNorm,
          first_names: firstNames.trim(),
          surname: surname.trim(),
          applicationStatus: 'incomplete',
          onboardingComplete: false,
          tempFlag: false,
        });

        return res.status(200).json({
          message: 'Registration resumed — continue your application.',
          token,
          userId: existing.id,
          role: 'tutor',
          resumed: true,
        });
      }

      return res.status(409).json({
        errors: ['An account with this email address already exists. Please log in to continue your application.'],
      });
    }

    const existingStudent = await pool.query(
      `SELECT u.id, u.email, a.status AS app_status
       FROM users u
       LEFT JOIN applications a ON a.user_id = u.id
       WHERE u.student_number = $1`,
      [studentNorm]
    );
    if (existingStudent.rows.length > 0) {
      return res.status(409).json({
        errors: ['This student number is already registered. Try logging in with the email you used previously.'],
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        `INSERT INTO users
           (surname, title, initials, first_names, email, cell,
            student_number, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'tutor')
         RETURNING id`,
        [
          surname.trim(),
          title.trim(),
          initials.trim(),
          firstNames.trim(),
          email.toLowerCase().trim(),
          cell.trim(),
          studentNumber.trim(),
          passwordHash,
        ]
      );

      const userId = userResult.rows[0].id;

      await client.query(
        `INSERT INTO applications (user_id, status)
         VALUES ($1, 'incomplete')`,
        [userId]
      );

      await client.query('COMMIT');

      const token = signAuthToken({
        userId,
        role: 'tutor',
        email: email.toLowerCase().trim(),
        first_names: firstNames.trim(),
        surname: surname.trim(),
        applicationStatus: 'incomplete',
        onboardingComplete: false,
        tempFlag: false,
      });

      return res.status(201).json({
        message: 'Account created successfully.',
        token,
        userId,
        role: 'tutor',
      });

    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error('Register error:', err.message);
    return res.status(500).json({ errors: ['Server error. Please try again.'] });
  }
});


router.post('/login', validateLogin, async (req, res) => {
  const { email, password } = req.body;

  const errors = [];
  if (!email || !String(email).trim()) {
    errors.push({ field: 'email', message: 'Email is required.' });
  }
  if (!password || !String(password).trim()) {
    errors.push({ field: 'password', message: 'Password is required.' });
  }

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  try {
    const userResult = await pool.query(
      `SELECT
         u.id,
         u.email,
         u.first_names,
         u.surname,
         u.password_hash,
         u.role,
         u.temp_password_flag,
         a.status AS application_status,
         COALESCE(tp.step1_complete, FALSE) AS step1_complete,
         COALESCE(tp.step2_complete, FALSE) AS step2_complete
       FROM users u
       LEFT JOIN applications a ON a.user_id = u.id
       LEFT JOIN tutor_profiles tp ON tp.user_id = u.id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ errors: ['Invalid email or password.'] });
    }

    const user = userResult.rows[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ errors: ['Invalid email or password.'] });
    }

    let applicationStatus = null;
    let onboardingComplete = false;

    if (user.role === 'tutor') {
      applicationStatus = user.application_status ?? null;
      onboardingComplete = !!(user.step1_complete && user.step2_complete);

      if (applicationStatus === 'approved') {
        await pool.query(
          `INSERT INTO tutor_profiles (user_id, step1_complete, step2_complete)
           VALUES ($1, FALSE, FALSE)
           ON CONFLICT (user_id) DO NOTHING`,
          [user.id]
        );
      }
    }

    const token = signAuthToken({
      userId:            user.id,
      role:              user.role,
      email:             user.email,
      first_names:       user.first_names,
      surname:           user.surname,
      applicationStatus,
      onboardingComplete,
      tempFlag:          user.temp_password_flag,
    });

    return res.status(200).json({
      token,
      role:              user.role,
      applicationStatus,
      onboardingComplete,
      tempFlag:          user.temp_password_flag,
      firstName:         user.first_names,
      surname:           user.surname,
    });

  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ errors: ['Server error. Please try again.'] });
  }
});


const authenticate = require('../middleware/authenticate');

router.patch('/change-password', authenticate, validateChangePassword, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const userId = req.user.userId;

  const errors = [];
  if (!currentPassword || !String(currentPassword).trim()) {
    errors.push({ field: 'currentPassword', message: 'Current password is required.' });
  }
  if (!newPassword || !String(newPassword).trim()) {
    errors.push({ field: 'newPassword', message: 'New password is required.' });
  }
  if (!confirmPassword || !String(confirmPassword).trim()) {
    errors.push({ field: 'confirmPassword', message: 'Confirm password is required.' });
  }
  if (newPassword) {
    const pwdMsg = passwordErrorMessage(newPassword);
    if (pwdMsg) {
      errors.push({ field: 'newPassword', message: pwdMsg.replace(/^Password/, 'New password') });
    }
  }
  if (newPassword !== confirmPassword) {
    errors.push({ field: 'confirmPassword', message: 'Passwords do not match.' });
  }

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  try {
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ errors: ['User not found.'] });
    }

    const match = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!match) {
      return res.status(401).json({ errors: ['Current password is incorrect.'] });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);

    const userResult = await pool.query(
      `SELECT
         u.id,
         u.role,
         u.email,
         u.first_names,
         u.surname,
         a.status AS application_status,
         COALESCE(tp.step1_complete, FALSE) AS step1_complete,
         COALESCE(tp.step2_complete, FALSE) AS step2_complete
       FROM users u
       LEFT JOIN applications a ON a.user_id = u.id
       LEFT JOIN tutor_profiles tp ON tp.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ errors: ['User not found.'] });
    }

    const user = userResult.rows[0];

    await pool.query(
      `UPDATE users
       SET password_hash = $1, temp_password_flag = FALSE
       WHERE id = $2`,
      [newHash, userId]
    );

    let applicationStatus = null;
    let onboardingComplete = false;

    if (user.role === 'tutor') {
      applicationStatus = user.application_status ?? null;
      onboardingComplete = !!(user.step1_complete && user.step2_complete);
    }

    const token = signAuthToken({
      userId:            user.id,
      role:              user.role,
      email:             user.email,
      first_names:       user.first_names,
      surname:           user.surname,
      applicationStatus,
      onboardingComplete,
      tempFlag:          false,
    });

    return res.status(200).json({
      message:           'Password updated successfully.',
      token,
      role:              user.role,
      applicationStatus,
      onboardingComplete,
      tempFlag:          false,
      firstName:         user.first_names,
      surname:           user.surname,
    });

  } catch (err) {
    console.error('Change password error:', err.message);
    return res.status(500).json({ errors: ['Server error. Please try again.'] });
  }
});


module.exports = router;
