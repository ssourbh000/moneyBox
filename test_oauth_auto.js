const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('\n🔐 OAuth Flow Automation\n');

    // Step 1: Login to MoneyBox
    console.log('Step 1️⃣ : Login to MoneyBox...');
    await page.goto('http://localhost:3000/login');
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
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

    const userInputs = await page.$$('input[type="text"], input[type="email"]');
    if (userInputs.length > 0) {
      await userInputs[0].fill('IK8071');
      console.log('  ✓ Username entered');
    }

    const passInputs = await page.$$('input[type="password"]');
    if (passInputs.length > 0) {
      await passInputs[0].fill('Sourabhcft@94');
      console.log('  ✓ Password entered');
    }

    const loginBtns = await page.$$('button');
    for (const btn of loginBtns) {
      const text = await btn.textContent();
      if (text && (text.includes('Login') || text.includes('Submit'))) {
        await btn.click();
        console.log('  ✓ Login clicked\n');
        break;
      }
    }

    // Step 5: Wait for code entry screen and prompt user
    console.log('Step 5️⃣ : Waiting for mobile app code screen...');
    await page.waitForTimeout(2000);
    console.log('\n📱 ==================== ACTION REQUIRED ====================');
    console.log('  Browser is open on the Kite mobile app code entry screen.');
    console.log('  Please enter the code from your Kite mobile app now.');
    console.log('  After you enter the code and approve, the browser will');
    console.log('  automatically redirect to MoneyBox settings.');
    console.log('  Script will wait up to 60 seconds...');
    console.log('========================================================\n');

    // Step 6: Wait for redirect back to MoneyBox (up to 60 seconds)
    let redirected = false;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(1000);
      const currentUrl = page.url();

      if (currentUrl.includes('localhost:3000/settings')) {
        redirected = true;
        break;
      }

      // Show progress every 10 seconds
      if ((i + 1) % 10 === 0) {
        console.log(`⏳ Still waiting... ${60 - (i + 1)}s remaining`);
      }
    }

    const finalUrl = page.url();
    console.log(`\n📍 Final URL: ${finalUrl}`);

    if (finalUrl.includes('settings') && !finalUrl.includes('error')) {
      console.log('✅ SUCCESS: Redirect completed successfully!');
      console.log('✅ Broker connection should be established!\n');
      await page.screenshot({ path: '/tmp/oauth_success.png' });
      console.log('📸 Screenshot saved: /tmp/oauth_success.png\n');
    } else if (finalUrl.includes('error')) {
      console.log('❌ Error detected in OAuth flow');
      await page.screenshot({ path: '/tmp/oauth_error.png' });
    } else {
      console.log('⏳ Still on Kite page - redirect may still be in progress');
      await page.screenshot({ path: '/tmp/oauth_wait.png' });
    }

    console.log('✅ Test complete. Browser will remain open for 10 seconds...\n');
    await page.waitForTimeout(10000);

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    await page.screenshot({ path: '/tmp/oauth_error.png' });
  } finally {
    await browser.close();
    console.log('Browser closed.\n');
  }
})();
