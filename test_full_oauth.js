const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('\n🔐 Full OAuth Test with Real Kite Credentials\n');
    
    // Step 1: Login to MoneyBox
    console.log('Step 1: Login to MoneyBox');
    await page.goto('http://localhost:3000/login');
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
    console.log('Step 2: Navigate to Settings');
    await page.goto('http://localhost:3000/settings');
    await page.waitForTimeout(1500);
    console.log('✅ Settings page loaded\n');
    
    // Step 3: Click Connect button
    console.log('Step 3: Click "Connect with Zerodha"');
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text && text.includes('Zerodha')) {
        await btn.click();
        break;
      }
    }
    
    // Wait for redirect to Kite
    await page.waitForURL('**/kite.zerodha.com/**', { timeout: 5000 });
    console.log('✅ Redirected to Kite login\n');
    
    // Step 4: Login to Kite
    console.log('Step 4: Login to Kite with provided credentials');
    console.log('  User: IK8071');
    console.log('  Password: [redacted]\n');
    
    // Wait for Kite login page to load
    await page.waitForLoadState('networkidle');
    
    // Try to fill the login form
    await page.fill('input[type="text"], input[type="email"], #userid', 'IK8071');
    await page.fill('input[type="password"], #password', 'Sourabhcft@94');
    
    // Click login button
    const loginBtns = await page.$$('button');
    for (const btn of loginBtns) {
      const text = await btn.textContent();
      if (text && (text.includes('Login') || text.includes('Sign'))) {
        await btn.click();
        break;
      }
    }
    
    console.log('⏳ Waiting for Kite to process login...');
    await page.waitForTimeout(3000);
    
    // Step 5: Look for approval/consent screen
    console.log('Step 5: Handle approval screen\n');
    const pageContent = await page.content();
    if (pageContent.includes('approve') || pageContent.includes('Approve')) {
      console.log('Found approval prompt, attempting to approve...');
      const approveBtns = await page.$$('button');
      for (const btn of approveBtns) {
        const text = await btn.textContent();
        if (text && text.includes('Approve')) {
          await btn.click();
          break;
        }
      }
    }
    
    // Step 6: Wait for redirect back to MoneyBox
    console.log('⏳ Waiting for redirect back to MoneyBox...');
    await page.waitForTimeout(3000);
    
    const finalUrl = page.url();
    console.log(`\n📍 Final URL: ${finalUrl}`);
    
    if (finalUrl.includes('settings')) {
      const errorEl = await page.$('.text-red-400');
      if (errorEl) {
        const errorText = await errorEl.textContent();
        console.log(`\n❌ Error shown: ${errorText}`);
      } else {
        console.log('\n✅ Back on settings page (check if connected)');
      }
    }
    
    await page.screenshot({ path: '/tmp/final_oauth_result.png' });
    console.log('\n📸 Screenshot: /tmp/final_oauth_result.png');
    
    await page.waitForTimeout(2000);
    
  } catch (err) {
    console.error('\n❌ Test error:', err.message);
    await page.screenshot({ path: '/tmp/oauth_error.png' });
  } finally {
    await browser.close();
  }
})();
