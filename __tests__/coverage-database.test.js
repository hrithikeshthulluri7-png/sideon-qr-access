/**
 * Database Module - Additional Coverage Tests
 * Focus on database.js initialization error paths and callback handling
 */

const { db, initializeDatabase } = require('../utils/database');

describe('Database Module - Deep Coverage', () => {
  describe('Table Creation Error Handling', () => {
    it('should handle index creation errors gracefully', (done) => {
      // Attempting to create duplicate index causes error
      db.run(
        `CREATE INDEX idx_tokens_token ON tokens(token)`,
        (err) => {
          expect(err).not.toBeNull();
          done();
        }
      );
    });

    it('should handle multiple index creation errors', (done) => {
      db.run(
        `CREATE INDEX idx_tokens_member_id ON tokens(member_id)`,
        (err) => {
          expect(err).not.toBeNull();
          done();
        }
      );
    });

    it('should handle expiresAt index creation errors', (done) => {
      db.run(
        `CREATE INDEX idx_tokens_expiresAt ON tokens(expiresAt)`,
        (err) => {
          expect(err).not.toBeNull();
          done();
        }
      );
    });

    it('should handle audit_logs timestamp index creation errors', (done) => {
      db.run(
        `CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp)`,
        (err) => {
          expect(err).not.toBeNull();
          done();
        }
      );
    });

    it('should handle audit_logs member_id index creation errors', (done) => {
      db.run(
        `CREATE INDEX idx_audit_logs_member_id ON audit_logs(member_id)`,
        (err) => {
          expect(err).not.toBeNull();
          done();
        }
      );
    });
  });

  describe('Foreign Key Constraints', () => {
    it('should enforce foreign key on token insertion', (done) => {
      db.run(
        `INSERT INTO tokens (member_id, token, expiresAt) VALUES (?, ?, ?)`,
        ['nonexistent_member', 'test_token', new Date().toISOString()],
        (err) => {
          expect(err).not.toBeNull();
          expect(err.message).toContain('FOREIGN KEY');
          done();
        }
      );
    });

    it('should cascade delete tokens when member is deleted', (done) => {
      const testMemberId = `cascade_test_${Date.now()}`;

      // Insert member
      db.run(
        `INSERT INTO members (member_id, name) VALUES (?, ?)`,
        [testMemberId, 'Cascade Test'],
        () => {
          // Insert token
          db.run(
            `INSERT INTO tokens (member_id, token, expiresAt) VALUES (?, ?, ?)`,
            [testMemberId, 'cascade_token', new Date().toISOString()],
            () => {
              // Delete member
              db.run(
                `DELETE FROM members WHERE member_id = ?`,
                [testMemberId],
                () => {
                  // Check that token was cascaded deleted
                  db.get(
                    `SELECT * FROM tokens WHERE member_id = ?`,
                    [testMemberId],
                    (err, row) => {
                      expect(err).toBeNull();
                      expect(row).toBeUndefined();
                      done();
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });

  describe('Database Connection Properties', () => {
    it('should have database object with run method', () => {
      expect(db).toBeDefined();
      expect(typeof db.run).toBe('function');
    });

    it('should have database object with get method', () => {
      expect(typeof db.get).toBe('function');
    });

    it('should have database object with all method', () => {
      expect(typeof db.all).toBe('function');
    });

    it('should have database object with serialize method', () => {
      expect(typeof db.serialize).toBe('function');
    });

    it('should support PRAGMA statements', (done) => {
      db.all('PRAGMA table_list', (err, tables) => {
        expect(err).toBeNull();
        expect(Array.isArray(tables)).toBe(true);
        done();
      });
    });

    it('should support PRAGMA foreign_keys check', (done) => {
      db.all('PRAGMA foreign_keys', (err, result) => {
        expect(err).toBeNull();
        expect(result[0]).toBeDefined();
        done();
      });
    });
  });

  describe('Complex Query Scenarios', () => {
    it('should handle joins with null values', (done) => {
      const testMemberId = `join_test_${Date.now()}`;

      db.run(
        `INSERT INTO members (member_id, name, email, mobile) VALUES (?, ?, ?, ?)`,
        [testMemberId, 'Join Test', null, null],
        () => {
          db.run(
            `INSERT INTO tokens (member_id, token, expiresAt) VALUES (?, ?, ?)`,
            [testMemberId, `join_token_${Date.now()}`, new Date().toISOString()],
            () => {
              db.get(
                `SELECT m.*, t.token FROM members m LEFT JOIN tokens t ON m.member_id = t.member_id
                 WHERE m.member_id = ?`,
                [testMemberId],
                (err, row) => {
                  expect(err).toBeNull();
                  expect(row).toBeDefined();
                  expect(row.email).toBeNull();
                  expect(row.token).toBeDefined();
                  done();
                }
              );
            }
          );
        }
      );
    });

    it('should handle COUNT aggregation', (done) => {
      db.get(
        `SELECT COUNT(*) as total FROM members`,
        (err, row) => {
          expect(err).toBeNull();
          expect(row.total).toBeGreaterThanOrEqual(0);
          done();
        }
      );
    });

    it('should handle MAX aggregation on timestamps', (done) => {
      db.get(
        `SELECT MAX(timestamp) as latest FROM audit_logs`,
        (err, row) => {
          expect(err).toBeNull();
          expect(row).toBeDefined();
          done();
        }
      );
    });

    it('should handle GROUP BY operations', (done) => {
      db.all(
        `SELECT operation, COUNT(*) as count FROM audit_logs GROUP BY operation`,
        (err, rows) => {
          expect(err).toBeNull();
          expect(Array.isArray(rows)).toBe(true);
          done();
        }
      );
    });

    it('should handle ORDER BY with LIMIT', (done) => {
      db.all(
        `SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 5`,
        (err, rows) => {
          expect(err).toBeNull();
          expect(Array.isArray(rows)).toBe(true);
          if (rows.length > 1) {
            const first = new Date(rows[0].timestamp);
            const second = new Date(rows[1].timestamp);
            expect(first.getTime()).toBeGreaterThanOrEqual(second.getTime());
          }
          done();
        }
      );
    });
  });

  describe('Update and Delete Operations', () => {
    it('should handle UPDATE with WHERE clause', (done) => {
      const testMemberId = `update_test_${Date.now()}`;

      db.run(
        `INSERT INTO members (member_id, name, agent) VALUES (?, ?, ?)`,
        [testMemberId, 'Update Test', 'OldAgent'],
        () => {
          db.run(
            `UPDATE members SET agent = ? WHERE member_id = ?`,
            ['NewAgent', testMemberId],
            function(err) {
              expect(err).toBeNull();
              expect(this.changes).toBe(1);

              db.get(
                `SELECT agent FROM members WHERE member_id = ?`,
                [testMemberId],
                (err, row) => {
                  expect(row.agent).toBe('NewAgent');
                  done();
                }
              );
            }
          );
        }
      );
    });

    it('should handle UPDATE with no matches', (done) => {
      db.run(
        `UPDATE members SET agent = ? WHERE member_id = ?`,
        ['Agent', 'nonexistent'],
        function(err) {
          expect(err).toBeNull();
          expect(this.changes).toBe(0);
          done();
        }
      );
    });

    it('should handle DELETE with WHERE clause', (done) => {
      const testMemberId = `delete_test_${Date.now()}`;

      db.run(
        `INSERT INTO members (member_id, name) VALUES (?, ?)`,
        [testMemberId, 'Delete Test'],
        () => {
          db.run(
            `DELETE FROM members WHERE member_id = ?`,
            [testMemberId],
            function(err) {
              expect(err).toBeNull();
              expect(this.changes).toBe(1);
              done();
            }
          );
        }
      );
    });

    it('should handle DELETE with no matches', (done) => {
      db.run(
        `DELETE FROM members WHERE member_id = ?`,
        ['nonexistent'],
        function(err) {
          expect(err).toBeNull();
          expect(this.changes).toBe(0);
          done();
        }
      );
    });
  });

  describe('Database Integrity Checks', () => {
    it('should list all tables', (done) => {
      db.all(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
        (err, rows) => {
          expect(err).toBeNull();
          const tableNames = rows.map(r => r.name);
          expect(tableNames).toContain('members');
          expect(tableNames).toContain('tokens');
          expect(tableNames).toContain('audit_logs');
          done();
        }
      );
    });

    it('should list all indexes', (done) => {
      db.all(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='tokens'`,
        (err, rows) => {
          expect(err).toBeNull();
          const indexNames = rows.map(r => r.name);
          expect(indexNames.length).toBeGreaterThan(0);
          done();
        }
      );
    });

    it('should validate schema structure', (done) => {
      db.all(
        `PRAGMA table_info(tokens)`,
        (err, columns) => {
          expect(err).toBeNull();
          expect(columns.length).toBeGreaterThan(0);
          // Verify critical columns exist
          const columnNames = columns.map(c => c.name);
          expect(columnNames).toContain('id');
          expect(columnNames).toContain('token');
          expect(columnNames).toContain('expiresAt');
          done();
        }
      );
    });
  });
});
