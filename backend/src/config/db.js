import dns from 'dns'
import mongoose from 'mongoose'

// Connects to MongoDB Atlas using the MONGODB_URI value from .env.
// If anything goes wrong, this function throws an error with a clear message.
export async function connectDB() {
  const uri = process.env.MONGODB_URI

  // 1. Make sure the variable exists and was actually filled in
  const isPlaceholder = !uri || uri.includes('your-cluster') || uri.includes('your-password') || uri.includes('<password>')
  if (isPlaceholder) {
    throw new Error(
      'MONGODB_URI is missing or still a placeholder. Copy your connection string from Atlas into backend/.env',
    )
  }

  // 2. Log connection problems that happen AFTER the first successful connect
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'))
  mongoose.connection.on('error', (err) => console.error('MongoDB error:', err.message))

  // 3. Use Google's public DNS so the mongodb+srv:// address can be looked up.
  //    (Fixes the "ECONNREFUSED" error when your default DNS refuses SRV lookups.)
  dns.setServers(['8.8.8.8', '8.8.4.4'])

  // 4. Connect. We give up after 10 seconds instead of Mongoose's default 30.
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
  } catch (err) {
    throw new Error(`${err.message}\n${getHint(err)}`)
  }

  const { host, name } = mongoose.connection
  console.log(`MongoDB connected: ${host} (database: "${name}")`)
}

// Turns common Atlas errors into a plain-English tip.
// We never print the connection string itself, because it contains your password.
function getHint(err) {
  const msg = err.message.toLowerCase()

  if (msg.includes('authentication failed') || msg.includes('bad auth')) {
    return 'Tip: the username or password in MONGODB_URI is wrong. Check your Database Access user in Atlas.'
  }
  if (msg.includes('querysrv') || msg.includes('enotfound')) {
    return 'Tip: the cluster address could not be found. Re-copy the connection string from Atlas, and check your internet/DNS.'
  }
  if (err.name === 'MongooseServerSelectionError' || msg.includes('server selection')) {
    return 'Tip: Atlas did not answer. Most often your IP address is not allowed. Add it under Network Access in Atlas.'
  }
  if (msg.includes('invalid') || msg.includes('scheme')) {
    return 'Tip: MONGODB_URI is not a valid connection string. It should start with mongodb+srv://'
  }
  return 'Tip: check MONGODB_URI in backend/.env and your Atlas settings.'
}