const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const page = await browser.newPage();

  try {
    console.log('🌐 Opening browser and testing OAuth...\n');
    
    // Go to login
    console.log('📝 Step 1: Navigating to login...');
    await page.goto('http://localhost:3000/login');
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    console.log('✅ Login page ready\n');
    
    // Fill credentials
    console.log('🔐 Step 2: Entering credentials...');
    await page.fill('input[type="email"]', 'xyz.ron008@gmail.com');
    await page.fill('input[type="password"]', 'Indorecity@111');
    
    // Click sign in
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text && text.includes('Sign')) {
        await btn.click();
        break;
      }
    }
    console.log('🔄 Signing in...');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Logged in\n');
    
    // Go to settings
    console.log('⚙️  Step 3: Going to settings...');
    await page.goto('http://localhost:3000/settings');
    await page.waitForTimeout(1500);
    console.log('✅ Settings page loaded\n');
    
    // Find and click Zerodha button
    console.log('🔘 Step 4: Finding "Connect with Zerodha" button...');
    const buttons2 = await page.$$('button');
    let connectBtn = null;
    for (const btn of buttons2) {
      const text = await btn.textContent();
      if (text && text.includes('Zerodha')) {
        connectBtn = btn;
        console.log('✅ Button found\n');
        break;
      }
    }
    
    if (!connectBtn) {
      throw new Error('Could not find Zerodha button');
    }
    
    // Track the API call
    console.log('🔐 Step 5: Clicking button and monitoring API...');
    let apiResponse = null;
    
    page.on('response', async (response) => {
      if (response.url().includes('/broker/zerodha/login')) {
        const status = response.status();
        console.log(`  📡 API Response: ${status}`);
        if (status === 200) {
          try {
            apiResponse = await response.json();
            console.log(`  ✅ Got login URL: ${apiResponse.url ? 'YES' : 'NO'}`);
          } catch (e) {
            console.log(`  ❌ Could not parse response`);
          }
        } else {
          console.log(`  ❌ API Error ${status}`);
        }
      }
    });
    
    // Click button
    await connectBtn.click();
    await page.waitForTimeout(2000);
    
    const currentUrl = page.url();
    console.log(`\n📍 Current URL: ${currentUrl}\n`);
    
    if (currentUrl.includes('kite') || currentUrl.includes('zerodha')) {
      console.log('✅ SUCCESS: Redirected to Zerodha OAuth!');
    } else if (currentUrl.includes('settings')) {
      console.log('❌ FAILED: Still on settings page');
      // Look for error message
      try {
        const errorEl = await page.$('.text-red-400');
        if (errorEl) {
          const errorText = await errorEl.textContent();
          console.log(`Error shown: ${errorText}`);
        }
      } catch (e) {}
    }
    
    await page.screenshot({ path: '/tmp/oauth_result.png' });
    console.log('\n📸 Screenshot saved to /tmp/oauth_result.png');
    
    await page.waitForTimeout(3000);
    
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    await page.screenshot({ path: '/tmp/test_error.png' });
    console.log('📸 Error screenshot saved');
  } finally {
    await browser.close();
  }
})();
