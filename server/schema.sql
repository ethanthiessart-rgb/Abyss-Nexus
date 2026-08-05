PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS advanced_report_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      changed_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(report_id) REFERENCES advanced_reports(id) ON DELETE CASCADE,
      FOREIGN KEY(changed_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS advanced_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_number TEXT NOT NULL UNIQUE,
      author_user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'draft',
      target_departments TEXT,
      attachment_url TEXT,
      signature TEXT,
      review_comment TEXT,
      reviewed_by_user_id INTEGER,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(author_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(reviewed_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS advanced_sanctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_user_id INTEGER NOT NULL,
      issued_by_user_id INTEGER NOT NULL,
      sanction_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_url TEXT,
      duration_minutes INTEGER,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending_validation',
      requires_validation INTEGER NOT NULL DEFAULT 1,
      validated_by_user_id INTEGER,
      validated_at TEXT,
      appeal_text TEXT,
      appeal_status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(issued_by_user_id) REFERENCES users(id),
      FOREIGN KEY(validated_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS announcement_departments (
        announcement_id INTEGER NOT NULL,
        department TEXT NOT NULL,
        PRIMARY KEY(announcement_id, department),
        FOREIGN KEY(announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        image_url TEXT,
        global_visible INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'published',
        publish_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT,
        FOREIGN KEY(author_id) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '[]',
      rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
      active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      last_used_at TEXT,
      request_count INTEGER NOT NULL DEFAULT 0,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS backup_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS career_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_user_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      event_date TEXT NOT NULL,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS chat_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      department TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS chat_members (
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      last_read_at TEXT,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(conversation_id, user_id),
      FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_user_id INTEGER NOT NULL,
      body TEXT,
      attachment_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS communication_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      audience_type TEXT NOT NULL,
      audience_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      scheduled_at TEXT,
      sent_at TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS communication_receipts (
      campaign_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(campaign_id, user_id),
      FOREIGN KEY(campaign_id) REFERENCES communication_campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS communication_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS department_permissions (
      department_id INTEGER NOT NULL,
      permission_key TEXT NOT NULL,
      PRIMARY KEY(department_id, permission_key),
      FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#3aa9ff',
      icon TEXT NOT NULL DEFAULT '🏢',
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS document_departments (
        document_id INTEGER NOT NULL,
        department TEXT NOT NULL,
        PRIMARY KEY(document_id, department),
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS document_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      department TEXT,
      description TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uploader_id INTEGER NOT NULL,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL UNIQUE,
        mime_type TEXT,
        size_bytes INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        folder TEXT NOT NULL DEFAULT 'Commun',
        version INTEGER NOT NULL DEFAULT 1,
        global_visible INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT,
        FOREIGN KEY(uploader_id) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS employee_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_user_id INTEGER NOT NULL,
      evaluator_user_id INTEGER,
      professionalism INTEGER NOT NULL,
      activity INTEGER NOT NULL,
      respect INTEGER NOT NULL,
      communication INTEGER NOT NULL,
      overall_score REAL NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(evaluator_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS employee_training (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_user_id INTEGER NOT NULL,
      training_id INTEGER NOT NULL,
      assigned_by_user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'assigned',
      comment TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(training_id) REFERENCES trainings(id) ON DELETE CASCADE,
      FOREIGN KEY(assigned_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS global_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      settings_json TEXT NOT NULL DEFAULT '{}',
      updated_by_user_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(updated_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS global_settings_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      changed_by_user_id INTEGER,
      old_settings_json TEXT NOT NULL,
      new_settings_json TEXT NOT NULL,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(changed_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_user_id INTEGER NOT NULL,
      request_type TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by_user_id INTEGER,
      review_comment TEXT,
      replacement_user_id INTEGER,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(reviewed_by_user_id) REFERENCES users(id),
      FOREIGN KEY(replacement_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS library_document_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      change_note TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(document_id, version_number),
      FOREIGN KEY(document_id) REFERENCES library_documents(id) ON DELETE CASCADE,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS library_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER,
      title TEXT NOT NULL,
      summary TEXT,
      tags TEXT,
      visibility TEXT NOT NULL DEFAULT 'public',
      department TEXT,
      current_version INTEGER NOT NULL DEFAULT 1,
      created_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(folder_id) REFERENCES document_folders(id) ON DELETE SET NULL,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS mail_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal'
          CHECK(priority IN ('normal', 'important', 'urgent', 'direction')),
        confidential INTEGER NOT NULL DEFAULT 0 CHECK(confidential IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(sender_id) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS mail_recipients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        recipient_id INTEGER NOT NULL,
        read_at TEXT,
        archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1)),
        deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0, 1)),
        UNIQUE(message_id, recipient_id),
        FOREIGN KEY(message_id) REFERENCES mail_messages(id) ON DELETE CASCADE,
        FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS maintenance_allowed_departments (
      department TEXT PRIMARY KEY
    );

CREATE TABLE IF NOT EXISTS maintenance_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      mode TEXT NOT NULL DEFAULT 'operational',
      message TEXT,
      return_unknown INTEGER NOT NULL DEFAULT 0,
      return_at TEXT,
      updated_by_user_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(updated_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS personnel_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_user_id INTEGER NOT NULL,
        actor_user_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(target_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(actor_user_id) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS planning_shift_members (
      shift_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY(shift_id, user_id),
      FOREIGN KEY(shift_id) REFERENCES planning_shifts(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS planning_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      location TEXT,
      color TEXT NOT NULL DEFAULT '#3aa9ff',
      notes TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_number TEXT NOT NULL UNIQUE,
        author_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        report_type TEXT NOT NULL,
        content TEXT NOT NULL,
        confidential INTEGER NOT NULL DEFAULT 0 CHECK(confidential IN (0, 1)),
        status TEXT NOT NULL DEFAULT 'submitted'
          CHECK(status IN ('draft', 'submitted', 'read', 'needs_revision', 'validated', 'refused', 'archived')),
        direction_comment TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        submitted_at TEXT,
        reviewed_at TEXT,
        reviewed_by INTEGER,
        FOREIGN KEY(author_id) REFERENCES users(id),
        FOREIGN KEY(reviewed_by) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS sanctions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sanction_number TEXT NOT NULL UNIQUE,
        target_user_id INTEGER NOT NULL,
        issued_by_user_id INTEGER NOT NULL,
        sanction_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        reason TEXT NOT NULL,
        comment TEXT,
        duration_label TEXT,
        starts_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ends_at TEXT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK(status IN ('active', 'expired', 'cancelled', 'archived')),
        cancelled_reason TEXT,
        cancelled_by_user_id INTEGER,
        cancelled_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(target_user_id) REFERENCES users(id),
        FOREIGN KEY(issued_by_user_id) REFERENCES users(id),
        FOREIGN KEY(cancelled_by_user_id) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS staff_grade_permissions (
      grade_id INTEGER NOT NULL,
      permission_key TEXT NOT NULL,
      PRIMARY KEY(grade_id, permission_key),
      FOREIGN KEY(grade_id) REFERENCES staff_grades(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS staff_grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      level INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '#3aa9ff',
      description TEXT,
      department_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(department_id) REFERENCES departments(id),
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS staff_profiles (
        user_id INTEGER PRIMARY KEY,
        signature TEXT,
        force_password_change INTEGER NOT NULL DEFAULT 0,
        first_login_notification INTEGER NOT NULL DEFAULT 1,
        created_by_user_id INTEGER,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(created_by_user_id) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS trainings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Générale',
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS user_grade_assignments (
      user_id INTEGER NOT NULL,
      grade_id INTEGER NOT NULL,
      assigned_by_user_id INTEGER,
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, grade_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(grade_id) REFERENCES staff_grades(id) ON DELETE CASCADE,
      FOREIGN KEY(assigned_by_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS user_permission_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        permission_key TEXT NOT NULL,
        effect TEXT NOT NULL CHECK(effect IN ('allow', 'deny')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, permission_key),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      theme TEXT NOT NULL DEFAULT 'abyss-blue',
      animations_enabled INTEGER NOT NULL DEFAULT 1,
      sounds_enabled INTEGER NOT NULL DEFAULT 0,
      glow_enabled INTEGER NOT NULL DEFAULT 1,
      desktop_notifications_enabled INTEGER NOT NULL DEFAULT 0,
      auto_lock_minutes INTEGER NOT NULL DEFAULT 15,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT UNIQUE,
        discord_username TEXT NOT NULL,
        avatar_url TEXT,
        matricule TEXT NOT NULL UNIQUE,
        identifier TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK(account_type IN ('personnel', 'direction')),
        grade TEXT NOT NULL,
        department TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'disabled', 'archived')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at TEXT
      );

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
      ON chat_messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_leave_status_dates
      ON leave_requests(status, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_library_documents_updated
      ON library_documents(updated_at);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
      ON notifications(user_id, read_at);

CREATE INDEX IF NOT EXISTS idx_reports_status_updated
      ON advanced_reports(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_sanctions_status_created
      ON advanced_sanctions(status, created_at);
