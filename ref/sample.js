exports.accountcleanup = functions.https.onRequest(async (req, res) => {
  const key = req.query.key;

  // Exit if the keys don't match.
  if (!secureCompare(key, functions.config().cron.key)) {
    console.log('The key provided in the request does not match the key set in the environment. Check that', key,
        'matches the cron.key attribute in `firebase env:get`');
    res.status(403).send('Security key does not match. Make sure your "key" URL query parameter matches the ' +
        'cron.key environment variable.');
    return null;
  }
  
  // Fetch all user details.
  const inactiveUsers = await getInactiveUsers();
  // Use a pool so that we delete maximum `MAX_CONCURRENT` users in parallel.
  const promisePool = new PromisePool(() => deleteInactiveUser(inactiveUsers), MAX_CONCURRENT);
  await promisePool.start();
  console.log('User cleanup finished');
  res.send('User cleanup finished');
  return null;
});

/**
 * Deletes one inactive user from the list.
 */
function deleteInactiveUser(inactiveUsers) {
  if (inactiveUsers.length > 0) {
    const userToDelete = inactiveUsers.pop();
    
    // Delete the inactive user.
    return admin.auth().deleteUser(userToDelete.uid).then(() => {
      return console.log('Deleted user account', userToDelete.uid, 'because of inactivity');
    }).catch((error) => {
      return console.error('Deletion of inactive user account', userToDelete.uid, 'failed:', error);
    });
  } else {
    return null;
  }
}

/**
 * Returns the list of all inactive users.
 */
async function getInactiveUsers(users = [], nextPageToken) {
  const result = await admin.auth().listUsers(1000, nextPageToken);
  // Find users that have not signed in in the last 30 days.
  const inactiveUsers = result.users.filter(
      user => Date.parse(user.metadata.lastSignInTime) < (Date.now() - 30 * 24 * 60 * 60 * 1000));
  
  // Concat with list of previously found inactive users if there was more than 1000 users.
  users = users.concat(inactiveUsers);
  
  // If there are more users to fetch we fetch them.
  if (result.pageToken) {
    return getInactiveUsers(users, result.pageToken);
  }
  
  return users;
}