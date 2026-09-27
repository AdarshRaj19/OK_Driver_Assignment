# How to Run Sentinel Video Intelligence (Step-by-Step)

A simple, beginner-friendly guide to set up and run the entire project locally without any errors.

---

## Prerequisites

Before starting, make sure you have **Node.js** installed on your computer:
- Download Node.js (v18, v20, or v22): [https://nodejs.org](https://nodejs.org)
- Check if it is installed by opening your terminal or Command Prompt and typing:
  ```bash
  node -v
  npm -v
  ```

---

## Step 1: Open the Project Folder

1. Open your terminal (**Command Prompt**, **PowerShell**, or **Git Bash** on Windows; or **Terminal** on macOS/Linux).
2. Navigate into the project directory:
   ```bash
   cd ok-driver-main
   ```

---

## Step 2: Install Dependencies

Run this command once to install all required packages:

```bash
npm install
```

> **Note:** Wait a few seconds until the installation finishes. You will see `added ... packages`.

---

## Step 3: Start the Application

Run the following command to start both the backend API server and frontend console simultaneously:

```bash
npm run dev
```

You will see:
- **API Server** running on `http://localhost:4000`
- **Frontend Dashboard** running on `http://localhost:5173`

Now, open your web browser (Chrome, Edge, Firefox, or Safari) and go to:
👉 **[http://localhost:5173](http://localhost:5173)**

The dashboard will open automatically logged in as Administrator.
*(If prompted to log in manually: Email: `admin@sentinel.local` | Password: `admin12345`)*

---

## Step 4: Run the Live Detection Simulator (For Demo Video)

To simulate live AI camera feeds, real-time vehicle detections, and watchlist alerts:

1. **Keep the first terminal running.**
2. Open a **second terminal window** in the same project folder (`ok-driver-main`).
3. Run:
   ```bash
   npm run simulate
   ```

**What you will see:**
- Detections streaming into your terminal and the dashboard every 5–8 seconds.
- Priority alert notifications appearing in real-time when watchlisted plates match.
- Real-time ingestion latency stat updating (~30 ms).
- Active alert markers pulsing red on the Leaflet map.

---

## Step 5: How to Stop

- To stop the application, go to your terminal window and press:
  `Ctrl + C` (then type `y` if asked).

---

## Useful Extra Commands

| Command | What it does |
| :--- | :--- |
| `npm test` | Runs the automated API test suite (verifies 401 auth, 409 duplicates, and alert creation). |
| `npm run lint` | Checks the codebase for syntax or formatting errors. |
| `npm run build` | Builds the optimized production bundle. |
| `npm run seed` | Re-populates demo cameras and watchlist entries if reset. |

---

## Troubleshooting

- **Port already in use?**
  If port `4000` or `5173` is busy, make sure you don't have an older instance running in another terminal. Close any hanging Node processes or restart your terminal.
- **Want a clean database reset?**
  Delete the `data/sentinel.sqlite` file and run `npm run dev` again. The server will automatically re-create and seed fresh demo data.
