import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { BurnGuard, CAT20, TransferGuard } from '@cat-protocol/cat-smartcontracts';
import cat20 from '../../smartcontracts/artifacts/contracts/token/cat20.json';
import burnGuard from '../../smartcontracts/artifacts/contracts/token//burnGuard.json';
import transferGuard from '../../smartcontracts/artifacts/contracts/token/transferGuard.json';


console.log('Buffer', Buffer)
function loadArtifacts() {
  try {
    console.log('cat20', cat20)
    CAT20.loadArtifact(cat20)
    BurnGuard.loadArtifact(burnGuard)
    TransferGuard.loadArtifact(transferGuard)
} catch (error) { /* empty */ }
}

loadArtifacts();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
