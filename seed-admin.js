// One-time script to create the very first Super Admin account, or add
// any other user afterward (once at least one admin exists, prefer
// doing that from the Users tab in Setup Console instead - this script
// is really only needed for the first account, since nothing else can
// create a user before an admin exists to do it from the UI).
//
// Usage:
//   node seed-admin.js <site-url> <username> <password> [role]
//
// role defaults to "admin" if omitted. Valid roles: admin, internal, agent.
// For an "agent" role, omit <password> or pass an empty string - agent
// accounts don't have one.
//
// Example:
//   node seed-admin.js https://ysuiteagent.netlify.app admin "MyStrongPass123!"
//   node seed-admin.js https://ysuiteagent.netlify.app jane "AnotherPass456" internal
//   node seed-admin.js https://ysuiteagent.netlify.app frontdesk "" agent

const siteUrl = process.argv[2];
const username = process.argv[3];
const password = process.argv[4] || '';
const role = process.argv[5] || 'admin';

function fail(message) {
  console.error(message);
  // Deliberately NOT process.exit() here - calling it immediately after
  // an async fetch (or even just having used fetch earlier in the
  // process) can crash on Windows with a libuv assertion
  // ("UV_HANDLE_CLOSING") because fetch's internal handles haven't
  // finished tearing down yet. Setting exitCode and letting the script
  // return naturally avoids that entirely - Node exits with the same
  // failure code once the event loop drains on its own.
  process.exitCode = 1;
}

async function main() {
  if (!siteUrl || !username) {
    fail('Usage: node seed-admin.js <site-url> <username> <password> [role]');
    return;
  }
  if (['admin', 'internal', 'agent'].indexOf(role) === -1) {
    fail('role must be one of: admin, internal, agent');
    return;
  }
  if (role !== 'agent' && !password) {
    fail('A password is required for admin/internal accounts (only agent accounts can skip it).');
    return;
  }

  const url = siteUrl.replace(/\/$/, '') + '/api/users';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seedFirstAdmin', username, password, role })
    });
  } catch (err) {
    fail('Could not reach ' + url + ' - ' + err.message + '. Check the site URL is right and the site is deployed.');
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) {
      fail('Failed: 404 - ' + url + ' doesn\'t exist on that site yet. This usually means the deployed site is running an older build that doesn\'t have the /api/users function - deploy the latest code first (git push, or however you normally deploy), then run this again.');
    } else {
      fail('Failed: ' + (body.error || res.status));
    }
    return;
  }
  console.log('Created "' + username + '" (' + role + '). You can now log in with it.');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
