# Inventra frontend (joined to the backend)

This is the Inventra UI (from `Inventra.html`) wired to the Inventra backend API. The browser computes nothing:
- **Removed from the original file:** the in-browser dataset, engine, replay and validator, and the state it kept in localStorage.
- **Now done by the backend:** every number, check, approval and correction, through the API in `../inventra-backend`. The backend is unchanged.

## Run

```bash
./start.sh            # backend on 127.0.0.1:8000 + frontend on http://localhost:3000
```

or run them separately:

```bash
cd ../inventra-backend && make demo        # API
python3 serve.py                           # UI on http://localhost:3000
```

Open **http://localhost:3000**, not 127.0.0.1:3000. The backend's default CORS setting allows exactly `http://localhost:3000`. To use an API at another address, add `?api=http://host:port` to the URL. Also add that origin to the backend's `CORS_ORIGINS` environment setting.

## What each tab calls

| Tab | Endpoints |
|---|---|
| Command Center | `GET /plan`, `POST /decisions` (approve / reject), `GET /inbox/events` |
| Data Hub | `GET /stock`, `GET /data/validation`, `POST /data/upload/{table}`, `GET/POST /corrections` |
| Demand Forecast | `GET /forecast` (daily / weekly), `GET /forecast/accuracy` |
| Inventory Network | `GET /network/projection`, `GET /network/ageing`, `POST /drafts/po` |
| Disruptions | `GET /signals`, `PATCH /signals/{id}`, `GET /signals/{id}/impact` |
| Scenario Lab | `POST/GET /scenario/trees`, `PATCH …/assumptions`, `POST …/nodes`, `POST /scenario/parse`, `GET /explain/{node}`, `GET /scenario/nodes/{id}/breaking-points`, `POST /decisions` (approve_path) |
| Decisions | `GET /decisions`, `GET /decisions/{id}`, `POST /decisions/{id}/recalculate` |
| Evaluation | `POST /evaluation/replay`, `GET /evaluation/report` |
| Shared | `GET /settings/mode`, `GET /freshness`, `POST /reset` |

## Human-in-the-loop behaviour in the UI
- **Approving:** every approval sends the input hash the planner was shown. If the plan changed since, the server refuses with 409; the UI shows why and refreshes.
- **Reasons:** reject, override, Fragile approvals, signal edits, corrections and confirming an unconfirmed PO all ask for a reason.
- **Blocked approvals:** Harmful or rule-failing paths can't be approved. The server re-checks every path on the shared plan, never on sandbox assumptions.
- **Evidence:** if a stock correction has a cycle count, the server requires it as evidence, and the form fills it in for the planner.
- **Recalculate:** recalculating a Stale decision shows the fresh option; it is approved only when the planner presses Approve.
- **Typed what-ifs:** they only fill the builder. Nothing runs until Run is pressed. They are available only when the backend has an LLM key.
- **Background loads:** the activity feed polls every 6 s, so files loaded by the backend's inbox-folder watcher appear here, with What changed.

## Reduced vs the original file (no backend endpoint exists for these)
- **Removed actions:** you can't undo a correction (record a new one instead) and you can't delete a tree node.
- **Data Hub tables:** the hub shows the tables the API serves. SKU master, lanes, holding costs, lead history, batches and cycle counts appear inside decision receipts instead.
- **Tree assumptions:** the shipping-cost multiplier and lane-lead sliders are gone, because the API doesn't expose lane values. Breaking points cover those sensitivities.
- **Projection charts:** they show the Do-nothing path and band. Option outcomes are compared numerically in the Scenario Lab.
- **Planning parameters:** current values aren't served. The panel shows changes made through corrections and lets you submit new ones.
- **Evaluation checklist:** it appears after the replay runs, because the server scores it as part of the replay.
- **Local-only state:** browser storage keeps only conveniences: theme, sound, keyless display, the tree id per SKU-location, and "not yet" answers to the PO question.
