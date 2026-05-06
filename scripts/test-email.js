require('dotenv').config();
const path = require('path');
const { testEmailConfig, sendEmail } = require(path.join(__dirname, '..', 'backend', 'utils', 'emailService'));

(async () => {
  console.log('Running email configuration test...');
  const res = await testEmailConfig();
  console.log('verify result:', res);

  if (process.env.TEST_EMAIL_TO) {
    console.log('Sending test email to', process.env.TEST_EMAIL_TO);
    const sendRes = await sendEmail(process.env.TEST_EMAIL_TO, 'Edekise Test Email', 'This is a test email from the local dev environment.', '<p>This is a test email from the local dev environment.</p>');
    console.log('send result:', sendRes);
  } else {
    console.log('Set TEST_EMAIL_TO in .env to send a test email.');
  }

  process.exit(0);
})().catch(err => {
  console.error('Test script error:', err);
  process.exit(1);
});
