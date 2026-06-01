import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import routes from './src/routes.js';
import errorMiddleware from './src/middlewares/error.middleware.js';
import { NotFoundError } from './src/utils/AppError.js';
import configureCloudinary from './src/config/cloudinary.js';

const app = express();

// Configure Cloudinary for file uploads
configureCloudinary();

// CORS configuration — MUST be before helmet and all other middleware
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'https://ujjwal-dental-frontend.vercel.app',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origin not allowed by CORS'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Handle preflight explicitly for all routes
app.options('/{*path}', cors());

// Security middleware — after CORS
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Cookie parsing middleware
app.use(cookieParser());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use('/api', routes);

// Handle 404 - Route not found
app.use((req, res, next) => {
  next(new NotFoundError(`Route ${req.originalUrl}`));
});

// Global error handler (must be last)
app.use(errorMiddleware);

export default app;


