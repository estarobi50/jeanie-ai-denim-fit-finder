# JEANIE — AI Denim Fitting App

## Setup (takes about 2 minutes)

### 1. Get your Anthropic API key
Go to https://console.anthropic.com → API Keys → Create Key
Copy the key (starts with sk-ant-...)

### 2. Create your .env file
In this folder, copy .env.example to .env:

  Windows:   copy .env.example .env
  Mac/Linux: cp .env.example .env

Then open .env and replace sk-ant-YOUR_KEY_HERE with your actual key.

### 3. Install dependencies
Open a terminal/PowerShell in this folder and run:

  npm install

(Takes 1-2 minutes the first time)

### 4. Start the app

  npm start

Your browser will open http://localhost:3000 automatically.

---

## How to use
1. Upload a full-body photo (drag & drop or click)
2. Click "Analyze My Body Shape"
3. Get your shape analysis + jean recommendations
4. See the best jean brands for your shape load automatically

## Notes
- Keep your .env file private — never share or commit it to git
- The app calls the Anthropic API directly from your browser (fine for local use)
- For a public deployment, move the API calls to a backend server
