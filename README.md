# React + Express Web App

A full-stack web application built with React (frontend) and Express/Node.js (backend).

## Project Structure

```
project/
├── backend/          # Express API server
│   ├── package.json
│   └── server.js
├── frontend/         # React application with Vite
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── App.css
│       └── index.css
└── README.md
```

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn

## Setup Instructions

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Start the backend server:
```bash
npm run dev
```

The backend will run on `http://localhost:5000`

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The frontend will run on `http://localhost:3000`

## Running Both Servers

Open two terminal windows:

**Terminal 1 (Backend):**
```bash
cd backend
npm install
npm run dev
```

**Terminal 2 (Frontend):**
```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

- `GET /` - Welcome message
- `GET /api/health` - Health check endpoint

## Features

- **Frontend**: React with Vite for fast development
- **Backend**: Express with CORS enabled
- **Proxy**: Frontend configured to proxy API requests to backend
- **Modern UI**: Beautiful gradient design with glassmorphism cards

## Development

### Backend Scripts
- `npm start` - Run server in production mode
- `npm run dev` - Run server with nodemon (auto-restart on changes)

### Frontend Scripts
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Technologies Used

- **Frontend**: React 18, Vite
- **Backend**: Express.js, Node.js
- **Styling**: CSS3 with modern features
