const mongoose = require('mongoose');

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

const BrokerAccount = mongoose.model('BrokerAccount', brokerAccountSchema);

(async () => {
  try {
    const mongoUri = 'mongodb+srv://sourabhsarkar000_db_user:LuRQoQINLdR2pKkv@cluster0.7ew4gi6.mongodb.net/';
    await mongoose.connect(mongoUri);
    
    console.log('Connected to MongoDB');
    
    // Check accounts for user 69e66c3062c5494c6832fe59
    const accounts = await BrokerAccount.find({ 
      userId: new mongoose.Types.ObjectId('69e66c3062c5494c6832fe59')
    });
    
    console.log('\nBroker accounts for user 69e66c3062c5494c6832fe59:');
    console.log(JSON.stringify(accounts, null, 2));
    
    if (accounts.length === 0) {
      console.log('\n⚠️  No broker accounts found for this user');
    } else {
      accounts.forEach((acc, i) => {
        console.log(`\nAccount ${i}:`);
        console.log(`  Broker: ${acc.broker}`);
        console.log(`  Status: ${acc.status}`);
        console.log(`  Client ID: ${acc.clientId}`);
        console.log(`  Token Expires: ${acc.tokenExpiresAt}`);
      });
    }
    
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
