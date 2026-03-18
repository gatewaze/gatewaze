import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/app/contexts/auth/Provider';
import { ThemeProvider } from '@/app/contexts/theme/ThemeProvider';
import { AppRouter } from '@/app/router';

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
