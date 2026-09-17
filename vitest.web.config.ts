import { defineConfig } from 'vitest/config'
export default defineConfig({test:{include:[
 'test/standalone-*.test.ts','test/standalone-*.test.tsx',
 'test/client-*.test.ts','test/client-*.test.tsx','src/client/quiz/**/*.test.ts','src/client/quiz/**/*.test.tsx',
 'test/core-supervisor.test.ts','test/generation-coordinator.test.ts','test/knowledge-base-source.test.ts',
 'test/product-contract.test.ts','test/product-core-rpc-client.test.ts','test/product-request-security.test.ts','test/product-routes.test.ts',
 'test/quiz-routes.test.ts','test/quiz-service.test.ts','test/evidence.test.ts','test/rpc-contract-fixtures.test.ts',
 ],exclude:['test/client-floating-workbench.test.tsx','test/client-registration.test.tsx','test/client-dsh-conversation-sessions.test.ts']}})
