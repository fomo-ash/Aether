# @aether/task-registry

The central registry for all executable tasks in the Aether platform. Instead of hardcoding capabilities into the orchestrator or database schema, this dynamic registry maps string `taskId`s (e.g., `git.clone`) to their physical implementations. Workers use this registry to load and execute the appropriate logic at runtime.

## Priority Version 1 Focus: Software Engineering

Aether Version 1 is explicitly positioned as an **AI-Powered Software Engineering Orchestrator**. The Task Registry currently prioritizes capabilities required for autonomous software development.

### Prioritized Task Categories
*These categories must be fully implemented for Version 1.*

- **LLM**: (`llm.generate`, `llm.analyze`)
- **Code Generation**: (`code.generateFile`, `code.refactor`)
- **Project Generation**: (`project.scaffoldNextJS`, `project.scaffoldExpress`)
- **Shell Execution**: (`shell.exec`)
- **Git**: (`git.clone`, `git.commit`, `git.push`, `git.branch`)
- **GitHub**: (`github.createRepo`, `github.openPR`)
- **Filesystem**: (`file.read`, `file.write`, `file.delete`, `file.mkdir`)
- **HTTP**: (`http.request`, `http.webhook`)
- **Package Manager**: (`package.npmInstall`, `package.pipInstall`)
- **Testing**: (`test.runJest`, `test.runPytest`)
- **Linting**: (`lint.runESLint`)
- **Deployment**: (`deploy.vercel`, `deploy.dockerBuild`, `deploy.dockerPush`)
- **Notification**: (`notification.slack`, `notification.discord`)

### Future Extensions
*The following categories are out-of-scope for Version 1 but will be implemented in future phases (e.g., General Workflow Automation).*

- Media & Image Processing
- PDF & Document Extraction
- Data Analytics (ETL, CSV parsing)
- Customer Support interactions
- AWS / GCP Resource Provisioning

## How to Register a Task

Adding a new capability to Aether requires **zero** changes to the core orchestrator or database schema. 

1. Create a new module inside `src/tasks/<category>/<action>.ts`.
2. Define the task implementation and metadata.
3. Call `registerTask()` to map the `taskId`.

```typescript
import { registerTask } from '../../registry';

registerTask({
  id: 'shell.exec',
  name: 'Execute Shell Command',
  category: 'shell'
});
```