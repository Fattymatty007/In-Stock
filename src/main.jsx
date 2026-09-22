import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import LicenseGate from './LicenseGate.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LicenseGate appName="In Stock">
      <App />
    </LicenseGate>
  </React.StrictMode>
);
