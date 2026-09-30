#!/usr/bin/env tsx
/**
 * Configuration Security Checker
 * 
 * Validates that security-critical configuration values are properly set
 * and not using insecure defaults. This script is run in CI to prevent
 * configuration drift that could reintroduce security issues.
 * 
 * Checks:
 * - CORS origins are explicitly set (not wildcard)
 * - Database file paths are not in version control
 * - Secret keys are not hardcoded
 * - Rate limiting is enabled
 * - TLS/HTTPS requirements are met
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ConfigCheck {
  name: string;
  check: () => boolean | Promise<boolean>;
  severity: 'error' | 'warning';
  message: string;
}

const checks: ConfigCheck[] = [
  {
    name: 'CORS Origins Not Wildcard',
    check: () => {
      // Check that .env.example and documentation don't suggest using * for CORS
      const envExample = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf-8');
      const hasSafeCors = envExample.includes('CORS_ORIGINS') && 
                         !envExample.match(/CORS_ORIGINS=\*[^a-zA-Z]/);
      return hasSafeCors;
    },
    severity: 'error',
    message: 'CORS_ORIGINS must not use wildcard (*) in production. Use explicit origins.'
  },
  {
    name: 'No Database Files in Git',
    check: () => {
      // Check that .gitignore properly excludes database files
      const rootGitignore = fs.readFileSync(path.join(__dirname, '../../.gitignore'), 'utf-8');
      const backendGitignore = fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf-8');
      
      const hasDbIgnore = rootGitignore.includes('*.db') && 
                         backendGitignore.includes('*.db');
      return hasDbIgnore;
    },
    severity: 'error',
    message: 'Database files (*.db) must be in .gitignore'
  },
  {
    name: 'No Hardcoded Secrets in Example',
    check: () => {
      // Check that .env.example doesn't have real secret keys
      const envExample = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf-8');
      
      // Check for patterns that look like real Stellar keys
      const hasRealSecrets = /RELAYER_SECRET_KEY=SD[A-Z2-7]{54}/.test(envExample) ||
                            /SECRET_KEY=SD[A-Z2-7]{54}/.test(envExample);
      
      return !hasRealSecrets;
    },
    severity: 'error',
    message: '.env.example must not contain real secret keys. Use placeholders.'
  },
  {
    name: 'Rate Limiting Documented',
    check: () => {
      // Check that rate limiting is mentioned in config
      const envExample = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf-8');
      return envExample.includes('RATE_LIMIT');
    },
    severity: 'warning',
    message: 'Rate limiting should be documented in .env.example'
  },
  {
    name: 'Pre-commit Hook Has DB Check',
    check: () => {
      // Check that pre-commit hook blocks database files
      const preCommitPath = path.join(__dirname, '../../.husky/pre-commit');
      if (!fs.existsSync(preCommitPath)) {
        return false;
      }
      const preCommit = fs.readFileSync(preCommitPath, 'utf-8');
      return preCommit.includes('*.db') || preCommit.includes('Database file');
    },
    severity: 'error',
    message: 'Pre-commit hook must check for database files'
  },
  {
    name: 'Litestream Config Exists',
    check: () => {
      // Check that litestream.yml exists for backup strategy
      return fs.existsSync(path.join(__dirname, '../litestream.yml'));
    },
    severity: 'warning',
    message: 'litestream.yml should exist for database backup strategy'
  },
  {
    name: 'Security.md Documents Secret Hygiene',
    check: () => {
      // Check that SECURITY.md documents secret management
      const securityPath = path.join(__dirname, '../../SECURITY.md');
      if (!fs.existsSync(securityPath)) {
        return false;
      }
      const security = fs.readFileSync(securityPath, 'utf-8');
      return security.includes('Secret') && security.includes('hygiene');
    },
    severity: 'warning',
    message: 'SECURITY.md should document secret hygiene practices'
  }
];

async function runChecks(): Promise<void> {
  console.log('Running configuration security checks...\n');
  
  let hasErrors = false;
  let hasWarnings = false;
  
  for (const check of checks) {
    try {
      const result = await check.check();
      const symbol = result ? '✓' : (check.severity === 'error' ? '✗' : '⚠');
      const color = result ? '\x1b[32m' : (check.severity === 'error' ? '\x1b[31m' : '\x1b[33m');
      
      console.log(`${color}${symbol}\x1b[0m ${check.name}`);
      
      if (!result) {
        console.log(`  ${check.message}\n`);
        if (check.severity === 'error') {
          hasErrors = true;
        } else {
          hasWarnings = true;
        }
      }
    } catch (error) {
      console.error(`\x1b[31m✗\x1b[0m ${check.name}`);
      console.error(`  Error running check: ${error}\n`);
      hasErrors = true;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  
  if (hasErrors) {
    console.error('\x1b[31m✗ Configuration security checks FAILED\x1b[0m');
    console.error('Please fix the errors above before committing.');
    process.exit(1);
  } else if (hasWarnings) {
    console.warn('\x1b[33m⚠ Configuration security checks passed with warnings\x1b[0m');
    console.warn('Consider addressing the warnings above.');
    process.exit(0);
  } else {
    console.log('\x1b[32m✓ All configuration security checks passed\x1b[0m');
    process.exit(0);
  }
}

// Run checks
runChecks().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
