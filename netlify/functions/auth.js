// netlify/functions/auth.js
//
// POST /api/auth   body: { action, ... }
//   action: "login"    { username, password? }
//     Admin/Internal accounts require the password to match. Agent
//     accounts have no password at all - only the username needs to
//     match an existing agent account. Returns { token, username, role,
//     expiresAt } on success, 401 on any failure (wrong username, wrong
//     password, disabled account) - deliberately the same generic error
//     either way, so a login attempt can't be used to probe which
//     usernames exist.
//   action: "logout"   { token }
//     Destroys the session. Always returns ok, even for an already-gone
//     token - logging out an already-logged-out session isn't an error.
//   action: "me"        (reads the Authorization header, no body needed)
//     Returns { username, role } for a still-valid token, or 401 - used
//     on page load to check whether a token saved in localStorage from a
//     previous visit is still good before showing the app instead of the
//     login screen.
//
// There's no "create the first admin" action here on purpose - that's a
// deliberately separate, one-time step (seed-admin.js) run from a
// trusted machine, not something reachable over the same API a regular
// login attempt could hit.

const { hashPassword, verifyPassword, getUsers, createSession, destroySession, requireSession } = require('./lib/auth');

exports.handler = async (event) => {
  const method = event.httpMethod;

  if (method === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (err) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    if (body.action === 'login') {
      const username = String(body.username || '').trim();
      if (!username) {
        return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Enter a username.' }) };
      }
      try {
        const users = await getUsers();
        const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase() && u.enabled !== false);
        if (!user) {
          return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Incorrect username or password.' }) };
        }
        if (user.role === 'agent') {
          // No password check at all for Agent accounts - deliberately.
        } else {
          const password = String(body.password || '');
          if (!password || !user.salt || !user.passwordHash || !verifyPassword(password, user.salt, user.passwordHash)) {
            return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Incorrect username or password.' }) };
          }
        }
        const session = await createSession(user.username, user.role);
        return {
          statusCode: 200, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: session.token, username: user.username, role: user.role, expiresAt: session.expiresAt })
        };
      } catch (err) {
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
      }
    }

    if (body.action === 'logout') {
      try {
        await destroySession(body.token);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
      } catch (err) {
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
      }
    }

    if (body.action === 'me') {
      const session = await requireSession(event);
      if (!session) return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not logged in.' }) };
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(session) };
    }

    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unknown action' }) };
  }

  return { statusCode: 405, body: 'Method not allowed' };
};
