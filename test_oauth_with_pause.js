const { chromium } = require('playwright');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function pause(msg) {
  return new Promise((resolve) => {
    rl.question(`\n⏸️  ${msg}\nPress ENTER to continue...`, () => {
      resolve();
    });
  });
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('\n🔐 OAuth Flow with Manual Code Entry\n');
    
    // Step 1: Login to MoneyBox
    console.log('Step 1️⃣ : Login to MoneyBox...');
    await page.goto('http://localhost:3000/login');
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', 'xyz.ron008@gmail.com');
    await page.fill('input[type="password"]', 'Indorecity@111');
    
    const btns = await page.$$('button');
    for (const btn of btns) {
      const text = await btn.textContent();
      if (text && text.includes('Sign')) {
        await btn.click();
        break;
      }
    }
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Logged in to MoneyBox\n');
    
    // Step 2: Go to settings
    console.log('Step 2️⃣ : Navigate to Settings...');
    await page.goto('http://localhost:3000/settings');
    await page.waitForTimeout(1500);
    console.log('✅ Settings loaded\n');
    
    // Step 3: Click Connect
    console.log('Step 3️⃣ : Click "Connect with Zerodha"...');
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text && text.includes('Zerodha')) {
        await btn.click();
        break;
      }
    }
    
    await page.waitForURL('**/kite.zerodha.com/**', { timeout: 5000 });
    console.log('✅ Redirected to Kite\n');
    
    // Step 4: Login to Kite
    console.log('Step 4️⃣ : Filling Kite login form...');
    await page.waitForLoadState('networkidle');
    
    // Fill username
    const userInputs = await page.$$('input[type="text"], input[type="email"]');
    if (userInputs.length > 0) {
      await userInputs[0].fill('IK8071');
      console.log('  ✓ Username entered');
    }
    
    // Fill password
    const passInputs = await page.$$('input[type="password"]');
    if (passInputs.length > 0) {
      await passInputs[0].fill('Sourabhcft@94');
      console.log('  ✓ Password entered');
    }
    
    // Click login
    const loginBtns = await page.$$('button');
    for (const btn of loginBtns) {
      const text = await btn.textContent();
      if (text && (text.includes('Login') || text.includes('Submit'))) {
        await btn.click();
        console.log('  ✓ Login clicked\n');
        break;
      }
    }
    
    // Step 5: Wait for code entry screen
    console.log('Step 5️⃣ : Waiting for mobile app code screen...');
    await page.waitForTimeout(3000);
    
    console.log('🔐 Mobile app code screen should be visible now\n');
    await pause('📱 Enter the code from your Kite mobile app when ready');
    
    // Step 6: Wait for approval/redirect
    console.log('\n⏳ Waiting for redirect after code entry...');
    await page.waitForTimeout(5000);
    
    const finalUrl = page.url();
    console.log(`\n📍 Final URL: ${finalUrl}`);
    
    if (finalUrl.includes('settings') && !finalUrl.includes('error')) {
      console.log('✅ SUCCESS: Broker should be connected!');
    } else if (finalUrl.includes('error')) {
      console.log('❌ Error in OAuth flow');
    } else {
      console.log('⏳ Still on Kite page - may need additional steps');
    }
    
    await page.screenshot({ path: '/tmp/oauth_final.png' });
    console.log('\n📸 Screenshot: /tmp/oauth_final.png');
    
    await pause('Check MoneyBox settings - press ENTER to close browser');
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    await page.screenshot({ path: '/tmp/oauth_error.png' });
  } finally {
    rl.close();
    await browser.close();
  }
})();
