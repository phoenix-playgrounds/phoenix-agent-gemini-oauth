# Basic Agent Instructions

## Code Style

- Never add comments to the code. NEVER.
- Do not delete existing comments though
- Follow Rails-way and Ruby-way

## Core Commands

- Install dependencies: `npm install`
- Dev server: TBD
- Tests: TBD
- Lint: TBD
- Console (REPL): TBD
- Integration tests: TBD

## Configuration

- Entire application configuration, including all ENVIRONMENT variables MUST be easily visible for developers. It means, for example, that whenever you have to add an ENV variable to code, you have to add those values to env.example file with a default value (if any)

## Business Logic

- ALWAYS try to handle edge cases and business logic requirements that may have been missed or omitted in a task for any reason

## Finalizing a task

- For every task, ensure LINTER passes and has no complains
- For every task, ensure TESTS pass, fix tests even if they do not fail because of your changes (unless user asks otherwise)
- For every task, ensure `bin/setup` does all the necessary work to spin up a fresh environment or upgrade existing one (idempotency is required)
- If you find appropriate, ensure `docker build . -t phoenix-agent:latest` passes (if required, add any arguments to this build command)
- If you find appropriate, ensure INTEGRATION_TESTS pass. However, sometimes it may requirement environment prepapration so you might not always be able to succeed

## Clean Code Guidelines

Guidelines for writing clean, maintainable, and human-readable code. Apply these rules when writing or reviewing code to ensure consistency and quality.

### What is Clean Code
- Clean code doesn’t contain duplication
- Clean code contains a minimal number of classes and other moving parts
- Clean code passes all tests
- Clean code is easier and cheaper to maintain!

### End Result of Each Task (do not stop untill all checks)
- Produce production-ready code that is ready to be used by real customers immediately unless asked otherwise explicitly
- Always follow coding styles of the project in general and the file you make changes in particular even if it doesn't follow best-practices or other instructions

### Constants Over Magic Numbers
- Replace hard-coded values with named constants
- Use descriptive constant names that explain the value's purpose
- Keep constants at the top of the file or in a dedicated constants file

### Meaningful Names
- Variables, functions, and classes should reveal their purpose
- Names should explain why something exists and how it's used
- Avoid abbreviations unless they're universally understood

### Comments
- No comments EVER under
- Under any circumstances do not add comments to the code
- Do not remove already existing comments if any

### Single Responsibility
- Each function should do exactly one thing
- Functions should be small and focused
- If a function needs a comment to explain what it does, it should be split

### DRY (Don't Repeat Yourself)
- Extract repeated code into reusable functions
- Share common logic through proper abstraction
- Maintain single sources of truth

### Clean Structure
- Keep related code together
- Organize code in a logical hierarchy
- Use consistent file and folder naming conventions

### Encapsulation
- Hide implementation details
- Expose clear interfaces
- Move nested conditionals into well-named functions

### Code Quality Maintenance
- Refactor continuously
- Fix technical debt early
- Leave code cleaner than you found it

### Testing
- Write tests before fixing bugs
- Keep tests readable and maintainable
- Test edge cases and error conditions
- Always cover the most critical parts of your changes with tests
- There is no need to cover EVERYTHING with tests

### Code Changes
- Prioritize minimal amount of code changes (that produce minimal git diff) to solve a task
- Normally do not refactor or change existing code if it doesn't solve a task if not asked otherwise
- In rare cases try to refactor code to not repeat itself into common functions if it REALLY helps to reduce amount of boilerplate

### Verify Information
- Always verify information before presenting it
- Do not make assumptions or speculate without clear evidence

### No Apologies
- Never use apologies.

### No Understanding Feedback
- Avoid giving feedback about understanding

### No Whitespace Suggestions
- Don't suggest whitespace changes

### No Inventions
- Don't invent changes other than what's explicitly requested

### No Unnecessary Confirmations
- Don't ask for confirmation of information already provided in the context

### Preserve Existing Code
- Don't remove unrelated code or functionalities
- Pay attention to preserving existing structures

### No Implementation Checks
- Don't ask the user to verify implementations that are visible in the provided context

### No Unnecessary Updates
- Don't suggest updates or changes to files when there are no actual modifications needed

### Provide Real File Links
- Always provide links to the real files, not x.md

### No Current Implementation
- Don't show or discuss the current implementation unless specifically requested
