import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard } from '@/middleware/AuthGuard';
import { AdminGuard } from '@/middleware/AdminGuard';
import { FeatureGuard } from '@/middleware/FeatureGuard';
import { SetupGuard } from '@/middleware/SetupGuard';
import { OnboardingGuard } from '@/middleware/OnboardingGuard';
import { MainLayout } from '@/app/layouts/MainLayout';
import { LoginPage } from '@/app/pages/auth/LoginPage';
import { AuthCallbackPage } from '@/app/pages/auth/AuthCallbackPage';

// Lazy-loaded pages
import { lazy, Suspense } from 'react';

const DashboardPage = lazy(() => import('@/app/pages/dashboard/DashboardPage'));
const EventsListPage = lazy(() => import('@/app/pages/events/EventsListPage'));
const EventDetailPage = lazy(() => import('@/app/pages/events/EventDetailPage'));
const EventCreatePage = lazy(() => import('@/app/pages/events/EventCreatePage'));
const CalendarsListPage = lazy(() => import('@/app/pages/calendars/CalendarsListPage'));
const CalendarDetailPage = lazy(() => import('@/app/pages/calendars/CalendarDetailPage'));
const MembersListPage = lazy(() => import('@/app/pages/members/MembersListPage'));
const MemberDetailPage = lazy(() => import('@/app/pages/members/MemberDetailPage'));
const EmailsPage = lazy(() => import('@/app/pages/admin/EmailsPage'));
const UsersPage = lazy(() => import('@/app/pages/admin/UsersPage'));
const DatabaseCopyPage = lazy(() => import('@/app/pages/admin/DatabaseCopyPage'));
const SettingsPage = lazy(() => import('@/app/pages/settings/SettingsPage'));
const SetupPage = lazy(() => import('@/app/pages/setup/SetupPage'));
const OnboardingPage = lazy(() => import('@/app/pages/onboarding/OnboardingPage'));

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

export function AppRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Setup wizard (first-run only) */}
        <Route path="/setup" element={<SetupPage />} />

        {/* Public routes */}
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        {/* Setup check + protected routes */}
        <Route element={<SetupGuard />}>
          <Route element={<AuthGuard />}>
            {/* Onboarding — full page, no sidebar (temp admin only) */}
            <Route path="/onboarding" element={<OnboardingPage />} />

            {/* Main app — blocked for temp admin by OnboardingGuard */}
            <Route element={<OnboardingGuard />}>
              <Route element={<MainLayout />}>
                <Route path="/" element={<Navigate to="/home" replace />} />

                <Route path="/home" element={
                  <FeatureGuard feature="dashboard_home">
                    <DashboardPage />
                  </FeatureGuard>
                } />

                {/* Events */}
                <Route path="/events" element={
                  <FeatureGuard feature="events">
                    <EventsListPage />
                  </FeatureGuard>
                } />
                <Route path="/events/new" element={
                  <FeatureGuard feature="events">
                    <EventCreatePage />
                  </FeatureGuard>
                } />
                <Route path="/events/:id" element={
                  <FeatureGuard feature="events">
                    <EventDetailPage />
                  </FeatureGuard>
                } />
                <Route path="/events/:id/:tab" element={
                  <FeatureGuard feature="events">
                    <EventDetailPage />
                  </FeatureGuard>
                } />

                {/* Calendars */}
                <Route path="/calendars" element={
                  <FeatureGuard feature="calendars">
                    <CalendarsListPage />
                  </FeatureGuard>
                } />
                <Route path="/calendars/:id" element={
                  <FeatureGuard feature="calendars">
                    <CalendarDetailPage />
                  </FeatureGuard>
                } />

                {/* Members */}
                <Route path="/members" element={
                  <FeatureGuard feature="dashboard_members">
                    <MembersListPage />
                  </FeatureGuard>
                } />
                <Route path="/members/:id" element={
                  <FeatureGuard feature="dashboard_members">
                    <MemberDetailPage />
                  </FeatureGuard>
                } />

                {/* Admin */}
                <Route element={<AdminGuard />}>
                  <Route path="/admin/emails" element={
                    <FeatureGuard feature="emails">
                      <EmailsPage />
                    </FeatureGuard>
                  } />
                  <Route path="/admin/users" element={
                    <FeatureGuard feature="users">
                      <UsersPage />
                    </FeatureGuard>
                  } />
                  <Route path="/admin/db-copy" element={
                    <FeatureGuard feature="db_copy">
                      <DatabaseCopyPage />
                    </FeatureGuard>
                  } />
                </Route>

                {/* Settings */}
                <Route path="/settings" element={
                  <FeatureGuard feature="settings">
                    <SettingsPage />
                  </FeatureGuard>
                } />
              </Route>
            </Route>
          </Route>
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </Suspense>
  );
}
