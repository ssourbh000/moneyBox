const mongoose = require('mongoose');
const path = require('path');

// Change to backend dir
process.chdir(path.join(__dirname, 'backend'));

const brokerAccountSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  broker: String,
  status: String,
  accessToken: String,
  tokenExpiresAt: Date,
  clientId: String,
  isPaper: Boolean,
  meta: Object,
}, { timestamps: true });

const BrokerAccount = mongoose.model('BrokerAccount_Test2', brokerAccountSchema);

(async () => {
  try {
    await mongoose.connect('mongodb+srv://sourabhsarkar000_db_user:LuRQoQINLdR2pKkv@cluster0.7ew4gi6.mongodb.net/');
    
    const testUserId = new mongoose.Types.ObjectId('69e66c3062c5494c6832fe59');
    
    // Try to insert a test document
    const result = await BrokerAccount.create({
      userId: testUserId,
      broker: 'zerodha',
      status: 'connected',
      accessToken: 'test_token_123',
      tokenExpiresAt: new Date(),
      clientId: 'TEST_CLIENT',
      isPaper: false,
      meta: { test: true },
    });
    
    console.log('✅ Insert successful');
    
    // Try to find it
    const found = await BrokerAccount.findById(result._id);
    console.log('✅ Found:', found ? 'yes' : 'no');
    
    // Clean up
    await BrokerAccount.deleteOne({ _id: result._id });
    console.log('✅ Cleanup successful');
    
    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
})();
