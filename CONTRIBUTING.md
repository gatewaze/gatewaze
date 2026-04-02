# Contributing to Gatewaze

Thank you for your interest in contributing to Gatewaze! This guide covers everything you need to get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Contributor License Agreement](#contributor-license-agreement)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Code Standards](#code-standards)
- [Commit Message Format](#commit-message-format)
- [Pull Request Process](#pull-request-process)
- [Module System](#module-system)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone. Be kind, constructive, and professional in all interactions.

## Contributor License Agreement

**You must sign the [Contributor License Agreement (CLA)](./CLA.md) before your first pull request can be merged.** The CLA ensures that contributions can be legally distributed under the project's Apache 2.0 license while you retain copyright over your work.

When you open your first PR, the CLA bot will guide you through the signing process.

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/<your-username>/gatewaze.git
   cd gatewaze
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/gatewaze/gatewaze.git
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Development Setup

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9
- **Docker** and **Docker Compose**
- **Git**

### Installation

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Copy the environment configuration:
   ```bash
   cp .env.example .env
   ```

3. Start the infrastructure services (Supabase, Redis, etc.):
   ```bash
   docker compose up -d
   ```

4. Run database migrations:
   ```bash
   pnpm db:migrate
   ```

5. Start the development servers:
   ```bash
   pnpm dev
   ```

   This starts all services concurrently:
   - **Admin app** (React + Vite): `http://localhost:5173`
   - **Public portal** (Next.js): `http://localhost:3000`
   - **API server** (Express): `http://localhost:4000`

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests for a specific package
pnpm --filter @gatewaze/admin test
pnpm --filter @gatewaze/portal test
pnpm --filter @gatewaze/api test

# Run end-to-end tests
pnpm test:e2e
```

### Linting and Formatting

```bash
# Run linter
pnpm lint

# Fix linting issues
pnpm lint:fix

# Format code
pnpm format

# Type check
pnpm typecheck
```

## Making Changes

1. **Keep your fork up to date** before starting work:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Make your changes** in a dedicated branch. Keep changes focused -- one feature or fix per branch.

3. **Write or update tests** for your changes.

4. **Verify your changes** pass all checks:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   ```

5. **Push your branch** and open a pull request.

## Code Standards

### TypeScript

- All code must be written in **TypeScript**. Avoid `any` types; use proper type definitions.
- Use **interfaces** for object shapes and **type aliases** for unions and intersections.
- Export types from dedicated `types.ts` files within each module.

### ESLint

The project uses ESLint with a shared configuration. All code must pass linting without errors.

- No unused variables or imports.
- No explicit `any` types without a documented reason.
- Prefer `const` over `let`. Never use `var`.

### Prettier

All code is formatted with Prettier. The configuration is defined in the repository root. Run `pnpm format` to auto-format your code before committing.

- Print width: 100
- Single quotes
- Trailing commas
- 2-space indentation

### File and Directory Naming

- Use **kebab-case** for file and directory names: `event-list.tsx`, `use-auth.ts`.
- Use **PascalCase** for React component files when they export a single component: `EventCard.tsx`.
- Colocate tests next to source files: `event-list.test.ts`.

### React

- Use **functional components** with hooks.
- Use **Radix Themes** components as the foundation for all UI elements.
- Keep components small and focused. Extract logic into custom hooks.

## Commit Message Format

This project follows the [Conventional Commits](https://www.conventionalcommits.org/) specification. Every commit message must follow this format:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Description                                           |
|------------|-------------------------------------------------------|
| `feat`     | A new feature                                         |
| `fix`      | A bug fix                                             |
| `docs`     | Documentation changes only                            |
| `style`    | Code style changes (formatting, semicolons, etc.)     |
| `refactor` | Code changes that neither fix a bug nor add a feature |
| `perf`     | Performance improvements                              |
| `test`     | Adding or updating tests                              |
| `build`    | Changes to build system or external dependencies      |
| `ci`       | Changes to CI configuration                           |
| `chore`    | Other changes that don't modify src or test files     |

### Scopes

Use the package or area name as the scope: `admin`, `portal`, `api`, `db`, `docs`, `config`.

### Examples

```
feat(admin): add event duplication action
fix(portal): resolve calendar timezone offset issue
docs: update contributing guide with module system section
refactor(api): extract registration validation into middleware
test(admin): add unit tests for event form validation
```

### Rules

- Use the **imperative mood** in the description: "add feature" not "added feature."
- Do not capitalize the first letter of the description.
- Do not end the description with a period.
- Keep the first line under **72 characters**.
- Use the body to explain **what** and **why**, not how.

## Pull Request Process

1. **Open a pull request** against the `main` branch of the upstream repository.

2. **Fill out the PR template** with a description of your changes, related issues, and testing steps.

3. **Ensure all CI checks pass**, including:
   - Linting
   - Type checking
   - Unit and integration tests
   - Build verification
   - CLA signature check

4. **Request a review** from a maintainer. At least one approval is required before merging.

5. **Address review feedback** by pushing additional commits to your branch. Do not force-push during review.

6. Once approved, a maintainer will **squash and merge** your PR.

### PR Guidelines

- Keep PRs small and focused. Large PRs are harder to review and more likely to have issues.
- Include screenshots or recordings for UI changes.
- Link related issues using GitHub keywords: `Closes #123`, `Fixes #456`.
- Update documentation if your changes affect user-facing behavior.

## Module System

Gatewaze uses a **module system** for extending functionality. Modules are self-contained packages that register capabilities with the core platform.

If you are building a new integration or extending Gatewaze's functionality, consider implementing it as a module rather than modifying core code. This keeps the core lean and allows users to opt in to features they need.

Modules can provide:

- **Event handlers** -- react to system events (registration created, event updated, etc.)
- **API routes** -- register additional API endpoints
- **Admin pages** -- add new pages or tabs to the admin interface
- **Portal components** -- extend the public-facing portal
- **Background jobs** -- register recurring or triggered background tasks

See the `docs/modules.md` guide for detailed instructions on creating and registering modules.

## Reporting Issues

When reporting a bug, please include:

- A clear and descriptive title
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Environment details (OS, Node.js version, browser)
- Screenshots or logs, if applicable

For feature requests, describe the problem you are trying to solve and your proposed solution.

---

Thank you for contributing to Gatewaze! Your work helps build a better event management platform for everyone.
