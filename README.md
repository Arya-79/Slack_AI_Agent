# Slack AI Agent

## Overview

Slack AI Agent is an automated onboarding assistant that monitors Slack workspace events, gathers information about newly joined members, performs basic research, analyzes the member using AI, stores the results in PostgreSQL, and posts a structured analysis report back to Slack.

---

## Features

* Detects new Slack members automatically
* Fetches member profile information from Slack
* Extracts:

  * Name
  * Email
  * Title
  * Timezone
* Performs company research using email domain
* Performs GitHub profile lookup
* Generates AI-powered:

  * Fit Score
  * Insights
  * Recommendations
* Stores analysis results in PostgreSQL
* Posts analysis reports to Slack channels

---

## Tech Stack

### Backend

* Node.js
* Express.js

### APIs & Integrations

* Slack Bolt SDK
* Slack Web API
* OpenAI API
* GitHub API

### Database

* PostgreSQL

### Hosting / Database Provider

* Render PostgreSQL

---

## Project Workflow

1. User joins Slack workspace or monitored channel.
2. Slack generates an event (`team_join` or `member_joined_channel`).
3. Bot receives the event.
4. Bot fetches complete member information using Slack API.
5. Basic research is performed:

   * Company lookup
   * GitHub lookup
6. Member information and research data are sent to OpenAI.
7. OpenAI generates:

   * Fit Score
   * Insights
   * Recommendations
8. Results are stored in PostgreSQL.
9. Final report is posted to Slack.

---

## Environment Variables

Create a `.env` file in the project root.

```env
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
OPENAI_API_KEY=
DATABASE_URL=
PORT=3000
NODE_ENV=development
```

## Database Setup

### Option 1: Existing Render Database

Obtain the PostgreSQL connection string and place it in:

```env
DATABASE_URL=
```

### Option 2: Create New PostgreSQL Database

1. Login to Render.
2. Click New → PostgreSQL.
3. Create a database.
4. Copy the External Database URL.
5. Add it to DATABASE_URL.

---

## Installation

Clone repository:

```bash
git clone <repository-url>
cd slack-ai-agent
```

Install dependencies:

```bash
npm install
```

Create .env file.

Start application:

```bash
npm start
```

Expected logs:

```text
Database connected
Slack bot connected
Express server running
```

---

## Database Table

Main table:

```text
member_analyses
```

Stores:

* Member ID
* Name
* Email
* Title
* Timezone
* Fit Score
* Insights
* Recommendations
* Analysis Timestamp

---

## Common Troubleshooting

### Slack events not received

Verify:

* Socket Mode enabled
* App installed to workspace
* Required OAuth scopes configured

### Database connection failed

Verify:

* DATABASE_URL is correct
* PostgreSQL server is running
* Network access is allowed

### OpenAI errors

Verify:

* OPENAI_API_KEY is valid
* API quota is available

---

## Author

Arya Chimurkar

Intern Project – Slack AI Agent
