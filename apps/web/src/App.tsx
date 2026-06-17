import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { BookingPage } from './pages/BookingPage';
import { LoginPage } from './pages/LoginPage';

export function App() {
  return (
    <>
      <nav className="nav">
        <strong>🏟️ SportsBooking</strong>
        <Link to="/book">Book a court</Link>
        <Link to="/login">Owner / Staff login</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to="/book" replace />} />
        <Route path="/book" element={<BookingPage />} />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </>
  );
}
