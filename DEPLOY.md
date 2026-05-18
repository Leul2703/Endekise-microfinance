Render + Vercel quick deploy guide

Overview
- Backend: Render (Node/Express)
- Frontend: Vercel (Vite/React)

High-level steps
1. Push your repository to GitHub (branch `main`).

Render (backend)
1. Go to https://dashboard.render.com and create a new Web Service.
2. Connect your GitHub repo and select the `main` branch.
3. Render will detect `render.yaml` and use it. If not, create a service with these settings:
   - Environment: Node
   - Root Directory / Path: `backend`
   - Build Command: `npm install`
   - Start Command: `npm start` (or `node server.js`)
4. Create a managed PostgreSQL database on Render (Dashboard → Databases) or provide an external `DATABASE_URL`.
5. In the service settings, set environment variables (Dashboard → Environment):
   - `DATABASE_URL` = (your database connection string)
   - `JWT_SECRET` = (strong secret)
   - `ENCRYPTION_KEY` = (32-byte key for encryption)
   - `FRONTEND_URL` = `https://<your-vercel-app>.vercel.app` (set after you deploy frontend)
   - Any email/SMTP keys (BREVO keys) used by app
6. Deploy. After successful deployment note the backend URL (e.g. `https://edekise-backend.onrender.com`).

Vercel (frontend)
1. Go to https://vercel.com and import the GitHub repo.
2. When prompted, set the project root to `/frontend`.
3. Set build settings:
   - Framework Preset: Other (or Vite)
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Add Environment Variable (Dashboard → Environment):
   - `VITE_API_BASE_URL` = `https://<your-render-service>.onrender.com/api`
   - (Optional) `NODE_ENV` = `production`
5. Deploy. After deploy, note Vercel URL (e.g. `https://edekise-frontend.vercel.app`).

Finalize
- Update `FRONTEND_URL` on Render to the Vercel URL.
- Update any email callback/reset links if needed.
- Verify OAuth/cookie settings for cross-site requests: if the backend sets cookies, ensure cookies use `SameSite=None; Secure` and backend is served over HTTPS.

Post-deploy checks
- Visit frontend URL and try login.
- Inspect network requests (browser devtools) to confirm requests go to `https://<render-service>.onrender.com/api`.
- Tail Render logs for the backend if requests fail.

Optional: Add CI/CD
- Use GitHub Actions or Vercel/Render automatic deploys on push to `main`.

If you want, I can:
- Create a sample `render.yaml` (done) and `vercel.json` (done).
- Walk you through connecting GitHub to Render/Vercel step-by-step.
- Create a simple GitHub Actions workflow to run tests and deploy (optional).
