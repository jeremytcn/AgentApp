// netlify/functions/users.js
//
// GET  /api/users            (requires an admin session)
//   -> { users: [{ username, role, enabled }, ...] } - never includes
//      password hashes or salts in the response, even to an admin.
//
// POST /api/users   body: { action, ... }
//   action: "seedFirstAdmin"   { username, password, role }
//     Deliberately UNAUTHENTICATED - there's no admin session yet to
//     require, since this is what creates the very first one. As a
//     safeguard against this becoming a standing backdoor, it only ever
//     works when the user list is completely empty; the moment any user
//     exists at all (of any role), this action always fails and every
//     other action below - all of which require an admin session -
//     becomes the only way to manage users. Meant to be run once, from
//     seed-admin.js on a trusted machine, immediately after first
//     deploying this app.
//   action: "create"   { username, password, role }   (admin only)
//   action: "update"   { username, password?, role?, enabled? }   (admin only)
//     password is only changed if provided; role/enabled are only
//     changed if provided, so a partial update doesn't clobber the rest.
//   action: "delete"   { username }   (admin only)
//     Refuses to delete the account making the request, so an admin
//     can't accidentally lock themselves out.

const { hashPassword, getUsers, saveUsers, requireSession, hasRole, ROLES } = require('./lib/auth');

function publicUser(u) {
  return { username: u.username, role: u.role, enabled: u.enabled !== false };
}

exports.handler = async (event) => {
  const method = event.httpMethod;

  if (method === 'GET') {
    const session = await requireSession(event);
    if (!hasRole(session, ['admin'])) return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Admin access required.' }) };
    const users = await getUsers();
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ users: users.map(publicUser) }) };
  }

  if (method === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (err) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    if (body.action === 'seedFirstAdmin') {
      const username = String(body.username || '').trim();
      const role = body.role || 'admin';
      if (!username) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Username is required.' }) };
      if (ROLES.indexOf(role) === -1) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid role.' }) };
      try {
        const users = await getUsers();
        if (users.length > 0) {
          return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'A user already exists - manage users from the Users tab in Setup Console instead.' }) };
        }
        const newUser = { username, role, enabled: true };
        if (role !== 'agent') {
          if (!body.password) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'A password is required for admin/internal accounts.' }) };
          const { salt, hash } = hashPassword(body.password);
          newUser.salt = salt; newUser.passwordHash = hash;
        }
        await saveUsers([newUser]);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
      } catch (err) {
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
      }
    }

    // Everything past this point requires an admin session.
    const session = await requireSession(event);
    if (!hasRole(session, ['admin'])) return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Admin access required.' }) };

    if (body.action === 'create') {
      const username = String(body.username || '').trim();
      const role = body.role;
      if (!username) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Username is required.' }) };
      if (ROLES.indexOf(role) === -1) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid role.' }) };
      try {
        const users = await getUsers();
        if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
          return { statusCode: 409, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'That username is already taken.' }) };
        }
        const newUser = { username, role, enabled: true };
        if (role !== 'agent') {
          if (!body.password) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'A password is required for admin/internal accounts.' }) };
          const { salt, hash } = hashPassword(body.password);
          newUser.salt = salt; newUser.passwordHash = hash;
        }
        users.push(newUser);
        await saveUsers(users);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ users: users.map(publicUser) }) };
      } catch (err) {
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
      }
    }

    if (body.action === 'update') {
      const username = String(body.username || '').trim();
      try {
        const users = await getUsers();
        const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
        if (!user) return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'User not found.' }) };
        if (body.role !== undefined) {
          if (ROLES.indexOf(body.role) === -1) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid role.' }) };
          user.role = body.role;
          if (body.role === 'agent') { delete user.salt; delete user.passwordHash; }
        }
        if (body.enabled !== undefined) user.enabled = !!body.enabled;
        if (body.password) {
          const { salt, hash } = hashPassword(body.password);
          user.salt = salt; user.passwordHash = hash;
        }
        await saveUsers(users);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ users: users.map(publicUser) }) };
      } catch (err) {
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
      }
    }

    if (body.action === 'delete') {
      const username = String(body.username || '').trim();
      if (session.username.toLowerCase() === username.toLowerCase()) {
        return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "You can't delete the account you're currently logged in as." }) };
      }
      try {
        const users = await getUsers();
        const next = users.filter((u) => u.username.toLowerCase() !== username.toLowerCase());
        if (next.length === users.length) return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'User not found.' }) };
        await saveUsers(next);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ users: next.map(publicUser) }) };
      } catch (err) {
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
      }
    }

    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unknown action' }) };
  }

  return { statusCode: 405, body: 'Method not allowed' };
};
