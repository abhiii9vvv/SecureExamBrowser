import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def connect(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def create_schema(conn):
    conn.executescript(
        '''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            email TEXT,
            full_name TEXT NOT NULL,
            student_id TEXT NOT NULL,
            role TEXT NOT NULL,
            department TEXT,
            course TEXT,
            branch TEXT,
            university TEXT,
            location TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS exams (
            id INTEGER PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT,
            duration_minutes INTEGER NOT NULL,
            start_time TEXT,
            end_time TEXT,
            passing_score REAL NOT NULL,
            status TEXT NOT NULL,
            total_questions INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY,
            exam_id INTEGER NOT NULL,
            order_index INTEGER NOT NULL,
            section TEXT,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            prompt TEXT NOT NULL,
            difficulty TEXT,
            points REAL NOT NULL DEFAULT 0,
            function_name TEXT,
            languages_json TEXT NOT NULL DEFAULT '[]',
            options_json TEXT NOT NULL DEFAULT '[]',
            examples_json TEXT NOT NULL DEFAULT '[]',
            constraints_json TEXT NOT NULL DEFAULT '[]',
            starter_code_json TEXT NOT NULL DEFAULT '{}',
            correct_option INTEGER,
            explanation TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS question_test_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL,
            input_json TEXT NOT NULL,
            output_json TEXT NOT NULL,
            hidden INTEGER NOT NULL DEFAULT 0,
            description TEXT,
            FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_token TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            exam_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            submitted_at TEXT,
            verification_status TEXT NOT NULL DEFAULT 'pending',
            verification_completed_at TEXT,
            flagged_json TEXT NOT NULL DEFAULT '[]',
            remaining_seconds INTEGER,
            machine_info_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (exam_id) REFERENCES exams(id)
        );

        CREATE TABLE IF NOT EXISTS answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            question_id INTEGER NOT NULL,
            answer_type TEXT NOT NULL,
            selected_option INTEGER,
            code TEXT,
            language TEXT,
            status TEXT,
            test_summary_json TEXT NOT NULL DEFAULT '{}',
            saved_at TEXT NOT NULL,
            UNIQUE (session_id, question_id),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS code_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            question_id INTEGER NOT NULL,
            language TEXT NOT NULL,
            mode TEXT NOT NULL,
            code TEXT NOT NULL,
            status TEXT NOT NULL,
            passed_count INTEGER NOT NULL,
            total_count INTEGER NOT NULL,
            total_time_ms INTEGER NOT NULL,
            runtime_details_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
            FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            exam_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            score REAL NOT NULL DEFAULT 0,
            summary_json TEXT NOT NULL DEFAULT '{}',
            submitted_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (exam_id) REFERENCES exams(id)
        );

        CREATE TABLE IF NOT EXISTS incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            session_id INTEGER,
            type TEXT NOT NULL,
            severity TEXT NOT NULL,
            message TEXT NOT NULL,
            details_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS biometric_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            biometric_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS model_assets (
            model_id TEXT PRIMARY KEY,
            family TEXT,
            version TEXT,
            github_url TEXT,
            source_url TEXT,
            local_path TEXT,
            status TEXT NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            checksum TEXT,
            synced_at TEXT,
            error_message TEXT
        );
        '''
    )
    conn.commit()


def seed_database(conn, seed_path: str):
    existing = conn.execute('SELECT COUNT(*) AS count FROM users').fetchone()['count']
    if existing > 0:
        return False

    with open(seed_path, 'r', encoding='utf-8') as handle:
        seed = json.load(handle)

    for user in seed.get('users', []):
        conn.execute(
            '''
            INSERT INTO users (id, username, password_hash, email, full_name, student_id, role, department, course, branch, university, location)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                user['id'], user['username'], user['passwordHash'], user.get('email'), user['fullName'],
                user['studentId'], user['role'], user.get('department'), user.get('course'),
                user.get('branch'), user.get('university'), user.get('location')
            )
        )

    for exam in seed.get('exams', []):
        conn.execute(
            '''
            INSERT INTO exams (id, code, name, description, duration_minutes, start_time, end_time, passing_score, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                exam['id'], exam['code'], exam['name'], exam.get('description'), exam['durationMinutes'],
                exam.get('startTime'), exam.get('endTime'), exam.get('passingScore', 0), exam.get('status', 'draft')
            )
        )

    for question in seed.get('questions', []):
        conn.execute(
            '''
            INSERT INTO questions (
                id, exam_id, order_index, section, type, title, prompt, difficulty, points,
                function_name, languages_json, options_json, examples_json, constraints_json,
                starter_code_json, correct_option, explanation
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                question['id'], question['examId'], question['orderIndex'], question.get('section'),
                question['type'], question['title'], question['prompt'], question.get('difficulty'),
                question.get('points', 0), question.get('functionName'), json.dumps(question.get('languages', [])),
                json.dumps(question.get('options', [])), json.dumps(question.get('examples', [])),
                json.dumps(question.get('constraints', [])), json.dumps(question.get('starterCode', {})),
                question.get('correctOption'), question.get('explanation')
            )
        )

        for test_case in question.get('testCases', []):
            conn.execute(
                '''
                INSERT INTO question_test_cases (question_id, input_json, output_json, hidden, description)
                VALUES (?, ?, ?, ?, ?)
                ''',
                (
                    question['id'], json.dumps(test_case.get('input', {})), json.dumps(test_case.get('output')),
                    1 if test_case.get('hidden') else 0, test_case.get('description')
                )
            )

    conn.execute(
        '''
        UPDATE exams
        SET total_questions = (
            SELECT COUNT(*) FROM questions WHERE questions.exam_id = exams.id
        )
        '''
    )
    conn.commit()
    return True


def parse_json(value, fallback):
    if not value:
        return fallback
    return json.loads(value)


def normalize_question(row, conn, include_tests=False):
    payload = {
        'id': row['id'],
        'examId': row['exam_id'],
        'orderIndex': row['order_index'],
        'section': row['section'],
        'type': row['type'],
        'title': row['title'],
        'prompt': row['prompt'],
        'difficulty': row['difficulty'],
        'points': row['points'],
        'functionName': row['function_name'],
        'languages': parse_json(row['languages_json'], []),
        'options': parse_json(row['options_json'], []),
        'examples': parse_json(row['examples_json'], []),
        'constraints': parse_json(row['constraints_json'], []),
        'starterCode': parse_json(row['starter_code_json'], {}),
        'correctOption': row['correct_option'],
        'explanation': row['explanation']
    }

    visible_count = conn.execute(
        'SELECT COUNT(*) AS count FROM question_test_cases WHERE question_id = ? AND hidden = 0',
        (row['id'],)
    ).fetchone()['count']
    payload['testCasesVisibleCount'] = visible_count

    if include_tests:
        tests = conn.execute(
            'SELECT * FROM question_test_cases WHERE question_id = ? ORDER BY id',
            (row['id'],)
        ).fetchall()
        payload['testCases'] = [
            {
                'input': parse_json(test['input_json'], {}),
                'output': parse_json(test['output_json'], None),
                'hidden': bool(test['hidden']),
                'description': test['description']
            }
            for test in tests
        ]

    return payload


def serialize_session_answers(conn, session_id):
    rows = conn.execute(
        '''
        SELECT answers.*, questions.type AS question_type
        FROM answers
        JOIN questions ON questions.id = answers.question_id
        WHERE answers.session_id = ?
        ORDER BY questions.order_index
        ''',
        (session_id,)
    ).fetchall()

    answers = {}
    for row in rows:
        question_id = str(row['question_id'])
        if row['answer_type'] == 'mcq':
            answers[question_id] = {
                'type': 'mcq',
                'selectedOption': row['selected_option'],
                'savedAt': row['saved_at']
            }
        else:
            answers[question_id] = {
                'type': 'coding',
                'code': row['code'] or '',
                'language': row['language'],
                'status': row['status'],
                'testSummary': parse_json(row['test_summary_json'], {}),
                'savedAt': row['saved_at']
            }
    return answers


def compute_submission_summary(conn, session_id, flagged_override=None):
    session = conn.execute('SELECT * FROM sessions WHERE id = ?', (session_id,)).fetchone()
    if not session:
        raise ValueError('Session not found')

    exam = conn.execute('SELECT passing_score FROM exams WHERE id = ?', (session['exam_id'],)).fetchone()
    questions = conn.execute(
        'SELECT id, points, type, correct_option FROM questions WHERE exam_id = ? ORDER BY order_index',
        (session['exam_id'],)
    ).fetchall()
    answers = conn.execute('SELECT * FROM answers WHERE session_id = ?', (session_id,)).fetchall()
    answer_map = {row['question_id']: row for row in answers}

    total_points = sum(float(row['points']) for row in questions)
    earned_points = 0.0
    answered = 0

    for question in questions:
        answer = answer_map.get(question['id'])
        if not answer:
            continue
        answered += 1
        if question['type'] == 'mcq':
            if answer['selected_option'] == question['correct_option']:
                earned_points += float(question['points'])
        else:
            summary = parse_json(answer['test_summary_json'], {})
            if summary.get('allPassed'):
                earned_points += float(question['points'])

    total_questions = len(questions)
    flagged = flagged_override if flagged_override is not None else parse_json(session['flagged_json'], [])
    score = round((earned_points / total_points) * 100, 2) if total_points else 0.0

    return {
        'sessionId': session_id,
        'examId': session['exam_id'],
        'answered': answered,
        'unanswered': total_questions - answered,
        'flagged': len(flagged),
        'flaggedQuestionIds': flagged,
        'score': score,
        'earnedPoints': earned_points,
        'totalPoints': total_points,
        'status': 'passed' if score >= float(exam['passing_score'] if exam else 60) else 'submitted',
        'answers': serialize_session_answers(conn, session_id)
    }


def action_init_db(conn, payload, seed_path):
    create_schema(conn)
    seeded = seed_database(conn, seed_path)
    return {
        'seeded': seeded,
        'dbPath': payload.get('dbPath'),
        'counts': {
            'users': conn.execute('SELECT COUNT(*) AS count FROM users').fetchone()['count'],
            'questions': conn.execute('SELECT COUNT(*) AS count FROM questions').fetchone()['count']
        }
    }


def action_login(conn, payload, _seed_path):
    username = str(payload.get('username', '')).strip()
    password = str(payload.get('password', ''))
    row = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()

    if not row or row['password_hash'] != password:
        conn.execute(
            'INSERT INTO incidents (user_id, session_id, type, severity, message, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (row['id'] if row else None, None, 'login_failed', 'low', f'Invalid login attempt for {username}', json.dumps({'username': username}), utc_now())
        )
        conn.commit()
        raise ValueError('Invalid username or password')

    return {
        'userId': row['id'],
        'fullName': row['full_name'],
        'role': row['role'],
        'studentId': row['student_id'],
        'email': row['email'],
        'course': row['course'],
        'branch': row['branch'],
        'university': row['university'],
        'location': row['location']
    }


def action_get_active_exam(conn, payload, _seed_path):
    row = conn.execute(
        'SELECT * FROM exams WHERE status = ? ORDER BY start_time ASC LIMIT 1',
        ('active',)
    ).fetchone()
    if not row:
        return None
    return {
        'id': row['id'],
        'code': row['code'],
        'name': row['name'],
        'description': row['description'],
        'durationMinutes': row['duration_minutes'],
        'startTime': row['start_time'],
        'endTime': row['end_time'],
        'passingScore': row['passing_score'],
        'status': row['status'],
        'totalQuestions': row['total_questions']
    }


def action_get_user_profile(conn, payload, _seed_path):
    row = conn.execute('SELECT * FROM users WHERE id = ?', (payload['userId'],)).fetchone()
    if not row:
        raise ValueError('User profile not found')
    return {
        'userId': row['id'],
        'fullName': row['full_name'],
        'studentId': row['student_id'],
        'role': row['role'],
        'department': row['department'],
        'course': row['course'],
        'branch': row['branch'],
        'university': row['university'],
        'location': row['location']
    }


def action_get_exam_questions(conn, payload, _seed_path):
    rows = conn.execute(
        'SELECT * FROM questions WHERE exam_id = ? ORDER BY order_index',
        (payload['examId'],)
    ).fetchall()
    return [normalize_question(row, conn, include_tests=False) for row in rows]


def action_get_question_for_execution(conn, payload, _seed_path):
    row = conn.execute('SELECT * FROM questions WHERE id = ?', (payload['questionId'],)).fetchone()
    if not row:
        raise ValueError('Question not found')
    return normalize_question(row, conn, include_tests=True)


def action_start_exam_session(conn, payload, _seed_path):
    now = utc_now()
    conn.execute(
        '''
        INSERT INTO sessions (session_token, user_id, exam_id, status, started_at, flagged_json, remaining_seconds, machine_info_json)
        VALUES (?, ?, ?, 'active', ?, '[]', ?, ?)
        ''',
        (
            payload['sessionToken'], payload['userId'], payload['examId'], now,
            payload.get('remainingSeconds'), json.dumps(payload.get('machineInfo', {}))
        )
    )
    conn.commit()
    return {
        'sessionId': conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id'],
        'sessionToken': payload['sessionToken']
    }


def action_end_exam_session(conn, payload, _seed_path):
    conn.execute(
        'UPDATE sessions SET status = ?, submitted_at = ? WHERE id = ?',
        (payload.get('status', 'completed'), utc_now(), payload['sessionId'])
    )
    conn.commit()
    return {'ended': True}


def action_save_mcq_answer(conn, payload, _seed_path):
    conn.execute(
        '''
        INSERT INTO answers (session_id, question_id, answer_type, selected_option, saved_at)
        VALUES (?, ?, 'mcq', ?, ?)
        ON CONFLICT(session_id, question_id) DO UPDATE SET
            answer_type = 'mcq',
            selected_option = excluded.selected_option,
            saved_at = excluded.saved_at,
            code = NULL,
            language = NULL,
            status = NULL,
            test_summary_json = '{}'
        ''',
        (payload['sessionId'], payload['questionId'], payload['selectedOption'], utc_now())
    )
    conn.commit()
    return {'saved': True}


def action_save_code_answer(conn, payload, _seed_path):
    conn.execute(
        '''
        INSERT INTO answers (session_id, question_id, answer_type, code, language, status, test_summary_json, saved_at)
        VALUES (?, ?, 'coding', ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, question_id) DO UPDATE SET
            answer_type = 'coding',
            code = excluded.code,
            language = excluded.language,
            status = excluded.status,
            test_summary_json = excluded.test_summary_json,
            saved_at = excluded.saved_at,
            selected_option = NULL
        ''',
        (
            payload['sessionId'], payload['questionId'], payload.get('code', ''), payload.get('language'),
            payload.get('status'), json.dumps(payload.get('testSummary', {})), utc_now()
        )
    )
    conn.commit()
    return {'saved': True}


def action_save_code_run(conn, payload, _seed_path):
    conn.execute(
        '''
        INSERT INTO code_runs (session_id, question_id, language, mode, code, status, passed_count, total_count, total_time_ms, runtime_details_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''',
        (
            payload.get('sessionId'), payload['questionId'], payload['language'], payload['mode'], payload['code'],
            payload['status'], payload['passedCount'], payload['totalCount'], payload['totalTimeMs'],
            json.dumps(payload.get('runtimeDetails', {})), utc_now()
        )
    )
    conn.commit()
    return {'saved': True}


def action_save_session_progress(conn, payload, _seed_path):
    conn.execute(
        'UPDATE sessions SET flagged_json = ?, remaining_seconds = COALESCE(?, remaining_seconds) WHERE id = ?',
        (json.dumps(payload.get('flaggedQuestionIds', [])), payload.get('remainingSeconds'), payload['sessionId'])
    )
    conn.commit()
    return {'saved': True}


def action_get_session_state(conn, payload, _seed_path):
    session = conn.execute('SELECT * FROM sessions WHERE id = ?', (payload['sessionId'],)).fetchone()
    if not session:
        raise ValueError('Session not found')
    return {
        'sessionId': session['id'],
        'status': session['status'],
        'verificationStatus': session['verification_status'],
        'flaggedQuestionIds': parse_json(session['flagged_json'], []),
        'remainingSeconds': session['remaining_seconds'],
        'answers': serialize_session_answers(conn, session['id'])
    }


def action_save_exam_submission(conn, payload, _seed_path):
    flagged_question_ids = payload.get('flaggedQuestionIds', [])
    conn.execute(
        'UPDATE sessions SET flagged_json = ?, remaining_seconds = ? WHERE id = ?',
        (json.dumps(flagged_question_ids), payload.get('timeRemaining'), payload['sessionId'])
    )
    summary = compute_submission_summary(conn, payload['sessionId'], flagged_question_ids)
    submitted_at = utc_now()
    conn.execute(
        '''
        INSERT INTO submissions (session_id, user_id, exam_id, status, score, summary_json, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
            status = excluded.status,
            score = excluded.score,
            summary_json = excluded.summary_json,
            submitted_at = excluded.submitted_at
        ''',
        (
            payload['sessionId'], payload['userId'], payload['examId'], summary['status'], summary['score'],
            json.dumps(summary), submitted_at
        )
    )
    conn.execute(
        'UPDATE sessions SET status = ?, submitted_at = ?, remaining_seconds = ?, flagged_json = ? WHERE id = ?',
        ('completed', submitted_at, payload.get('timeRemaining'), json.dumps(payload.get('flaggedQuestionIds', [])), payload['sessionId'])
    )
    conn.commit()
    summary['submittedAt'] = submitted_at
    return summary


def action_get_submission_summary(conn, payload, _seed_path):
    session_id = payload['sessionId']
    row = conn.execute('SELECT * FROM submissions WHERE session_id = ?', (session_id,)).fetchone()
    if row:
        summary = parse_json(row['summary_json'], {})
        summary['submittedAt'] = row['submitted_at']
        return summary
    return compute_submission_summary(conn, session_id)


def action_get_dashboard_stats(conn, payload, _seed_path):
    active_sessions = conn.execute("SELECT COUNT(*) AS count FROM sessions WHERE status = 'active'").fetchone()['count']
    today_violations = conn.execute('SELECT COUNT(*) AS count FROM incidents').fetchone()['count']
    recent_submissions = conn.execute('SELECT COUNT(*) AS count FROM submissions').fetchone()['count']
    return {
        'activeSessions': active_sessions,
        'todayViolations': today_violations,
        'recentSubmissions': recent_submissions
    }


def action_get_active_sessions(conn, payload, _seed_path):
    rows = conn.execute(
        '''
        SELECT sessions.id, sessions.session_token, sessions.started_at, sessions.verification_status,
               users.full_name, users.student_id, users.id AS user_id,
               exams.name AS exam_name, exams.code AS exam_code
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        JOIN exams ON exams.id = sessions.exam_id
        WHERE sessions.status = 'active'
        ORDER BY sessions.started_at DESC
        '''
    ).fetchall()
    return [
        {
            'sessionId': row['id'],
            'sessionToken': row['session_token'],
            'startedAt': row['started_at'],
            'verificationStatus': row['verification_status'],
            'fullName': row['full_name'],
            'studentId': row['student_id'],
            'userId': row['user_id'],
            'examName': row['exam_name'],
            'examCode': row['exam_code'],
            'status': 'active'
        }
        for row in rows
    ]


def action_get_recent_submissions(conn, payload, _seed_path):
    rows = conn.execute(
        '''
        SELECT submissions.*, users.full_name, users.student_id, exams.name AS exam_name
        FROM submissions
        JOIN users ON users.id = submissions.user_id
        JOIN exams ON exams.id = submissions.exam_id
        ORDER BY submissions.submitted_at DESC
        LIMIT ?
        ''',
        (payload.get('limit', 10),)
    ).fetchall()
    return [
        {
            'submissionId': row['id'],
            'sessionId': row['session_id'],
            'fullName': row['full_name'],
            'studentId': row['student_id'],
            'examName': row['exam_name'],
            'status': row['status'],
            'score': row['score'],
            'submittedAt': row['submitted_at']
        }
        for row in rows
    ]


def action_save_biometric_data(conn, payload, _seed_path):
    now = utc_now()
    conn.execute(
        'INSERT INTO biometric_records (user_id, biometric_type, payload_json, created_at) VALUES (?, ?, ?, ?)',
        (payload['userId'], payload['biometricType'], json.dumps(payload.get('payload', {})), now)
    )
    conn.execute(
        'UPDATE sessions SET verification_status = ?, verification_completed_at = ? WHERE user_id = ? AND status = ?',
        ('verified', now, payload['userId'], 'active')
    )
    conn.commit()
    return {'saved': True}


def action_upsert_model_asset(conn, payload, _seed_path):
    conn.execute(
        '''
        INSERT INTO model_assets (model_id, family, version, github_url, source_url, local_path, status, size_bytes, checksum, synced_at, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(model_id) DO UPDATE SET
            family = excluded.family,
            version = excluded.version,
            github_url = excluded.github_url,
            source_url = excluded.source_url,
            local_path = excluded.local_path,
            status = excluded.status,
            size_bytes = excluded.size_bytes,
            checksum = excluded.checksum,
            synced_at = excluded.synced_at,
            error_message = excluded.error_message
        ''',
        (
            payload['modelId'], payload.get('family'), payload.get('version'), payload.get('githubUrl'),
            payload.get('sourceUrl'), payload.get('localPath'), payload.get('status', 'unknown'),
            payload.get('sizeBytes', 0), payload.get('checksum'), payload.get('syncedAt'), payload.get('errorMessage')
        )
    )
    conn.commit()
    return {'saved': True}


def action_get_model_assets(conn, payload, _seed_path):
    rows = conn.execute('SELECT * FROM model_assets ORDER BY model_id').fetchall()
    return [dict(row) for row in rows]


def action_record_incident(conn, payload, _seed_path):
    conn.execute(
        'INSERT INTO incidents (user_id, session_id, type, severity, message, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (
            payload.get('userId'), payload.get('sessionId'), payload['type'], payload.get('severity', 'medium'),
            payload['message'], json.dumps(payload.get('details', {})), utc_now()
        )
    )
    conn.commit()
    return {'saved': True}


def action_get_recent_incidents(conn, payload, _seed_path):
    rows = conn.execute(
        '''
        SELECT incidents.*, users.full_name, users.student_id
        FROM incidents
        LEFT JOIN users ON users.id = incidents.user_id
        ORDER BY incidents.created_at DESC
        LIMIT ?
        ''',
        (payload.get('limit', 10),)
    ).fetchall()
    return [
        {
            'id': row['id'],
            'type': row['type'],
            'severity': row['severity'],
            'message': row['message'],
            'createdAt': row['created_at'],
            'fullName': row['full_name'],
            'studentId': row['student_id'],
            'details': parse_json(row['details_json'], {})
        }
        for row in rows
    ]


def action_get_database_status(conn, payload, _seed_path):
    return {
        'connected': True,
        'engine': 'sqlite',
        'mode': 'local',
        'path': payload.get('dbPath'),
        'users': conn.execute('SELECT COUNT(*) AS count FROM users').fetchone()['count'],
        'questions': conn.execute('SELECT COUNT(*) AS count FROM questions').fetchone()['count']
    }


ACTIONS = {
    'init_db': action_init_db,
    'login': action_login,
    'get_active_exam': action_get_active_exam,
    'get_user_profile': action_get_user_profile,
    'get_exam_questions': action_get_exam_questions,
    'get_question_for_execution': action_get_question_for_execution,
    'start_exam_session': action_start_exam_session,
    'end_exam_session': action_end_exam_session,
    'save_mcq_answer': action_save_mcq_answer,
    'save_code_answer': action_save_code_answer,
    'save_code_run': action_save_code_run,
    'save_session_progress': action_save_session_progress,
    'get_session_state': action_get_session_state,
    'save_exam_submission': action_save_exam_submission,
    'get_submission_summary': action_get_submission_summary,
    'get_dashboard_stats': action_get_dashboard_stats,
    'get_active_sessions': action_get_active_sessions,
    'get_recent_submissions': action_get_recent_submissions,
    'save_biometric_data': action_save_biometric_data,
    'upsert_model_asset': action_upsert_model_asset,
    'get_model_assets': action_get_model_assets,
    'record_incident': action_record_incident,
    'get_recent_incidents': action_get_recent_incidents,
    'get_database_status': action_get_database_status,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True)
    parser.add_argument('--action', required=True)
    parser.add_argument('--seed', required=False, default='')
    args = parser.parse_args()

    payload = {}
    raw = sys.stdin.read().strip() if 'sys' in globals() else ''
    if raw:
        payload = json.loads(raw)
    payload['dbPath'] = args.db

    db_dir = Path(args.db).parent
    db_dir.mkdir(parents=True, exist_ok=True)

    conn = connect(args.db)
    try:
        create_schema(conn)
        handler = ACTIONS.get(args.action)
        if not handler:
            raise ValueError(f'Unsupported action: {args.action}')
        result = handler(conn, payload, args.seed)
        print(json.dumps({'success': True, 'data': result}))
    except Exception as exc:
        conn.rollback()
        print(json.dumps({'success': False, 'error': str(exc)}))
    finally:
        conn.close()


if __name__ == '__main__':
    import sys
    main()
