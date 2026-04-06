import 'dotenv/config';
import app from '../app.js';
import connectDB from '../src/config/db.js';

// Connect to database once (cached across invocations)
let isConnected = false;

const handler = async (req, res) => {
  if (!isConnected) {
    await connectDB();
    isConnected = true;
  }
  return app(req, res);
};

export default handler;
