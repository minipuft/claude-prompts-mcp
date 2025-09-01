# Prompt Management

This document describes how to manage prompts in the MCP server using the distributed prompts configuration system.

## Distributed Prompts Configuration System

The MCP server now uses a distributed configuration system where prompts are organized by category, with each category having its own configuration file. This makes it easier to manage large numbers of prompts and enables modular organization.

### Key Components

1. **promptsConfig.json** - The main configuration file that defines categories and imports category-specific prompts.json files
2. **Category-specific prompts.json files** - Each category has its own prompts.json file in its directory

## Main Configuration (promptsConfig.json)

The main configuration file defines all available categories and specifies which category-specific prompts.json files to import:

```json
{
  "categories": [
    {
      "id": "general",
      "name": "General",
      "description": "General-purpose prompts for everyday tasks"
    },
    {
      "id": "code",
      "name": "Code",
      "description": "Prompts related to programming and software development"
    }
    // More categories...
  ],
  "imports": [
    "prompts/general/prompts.json",
    "prompts/code/prompts.json",
    "prompts/analysis/prompts.json"
    // More imports...
  ]
}
```

### Categories

Each category in the `categories` array has the following properties:

- `id` (string) - Unique identifier for the category (used in URLs and file paths)
- `name` (string) - Display name for the category
- `description` (string) - Description of what the category is for

### Imports

The `imports` array lists the paths to the category-specific prompts.json files, relative to the server's working directory.

## Category-Specific Prompts Files

Each category has its own prompts.json file in its directory (e.g., `prompts/general/prompts.json`):

```json
{
  "prompts": [
    {
      "id": "friendly_greeting",
      "name": "Friendly Greeting",
      "category": "general",
      "description": "A warm, personalized greeting that makes the user feel welcome and valued.",
      "file": "friendly_greeting.md",
      "arguments": [
        {
          "name": "name",
          "description": "The name of the person to greet",
          "required": false
        }
      ]
    }
    // More prompts...
  ]
}
```

Each prompt in the `prompts` array has:

- `id` (string) - Unique identifier for the prompt
- `name` (string) - Display name for the prompt
- `category` (string) - Category this prompt belongs to
- `description` (string) - Description of what the prompt does
- `file` (string) - Path to the markdown file containing the prompt template, relative to the category directory
- `arguments` (array) - Arguments accepted by the prompt
  - `name` (string) - Name of the argument
  - `description` (string) - Description of the argument
  - `required` (boolean) - Whether this argument is required
- `isChain` (boolean, optional) - Whether this prompt is a chain of prompts
- `chainSteps` (array, optional) - Steps in the chain if this is a chain prompt
- `tools` (boolean, optional) - Whether this prompt should use available tools
- `onEmptyInvocation` (string, optional) - Defines behavior when a prompt is invoked without its defined arguments.
  - `"return_template"`: If invoked with no arguments, the server returns a description of the prompt, its purpose, and its arguments instead of attempting to execute it. This is useful for prompts that strictly require specific inputs.
  - `"execute_if_possible"` (default): If invoked with no arguments, the server attempts to execute the prompt, typically by using contextual information (like `{{previous_message}}`) for any missing arguments. This is the standard behavior if the field is omitted.

## Advanced Templating with Nunjucks

The prompt templating engine now supports **Nunjucks**, a powerful templating language that allows for more dynamic and flexible prompt construction. This is in addition to the standard `{{variable}}` placeholder replacement.

### Key Nunjucks Features Available:

- **Conditional Logic (`{% if %}`):** Show or hide parts of your prompt based on whether arguments are provided or have specific values.
- **Loops (`{% for %}`):** Iterate over lists or arrays provided as arguments to dynamically generate parts of your prompt.
- **Standard Placeholder Syntax:** The familiar `{{variable}}` syntax for simple variable replacement continues to work as before. Nunjucks handles these as well.

### How Nunjucks is Processed:

1.  **Nunjucks Rendering:** The entire `User Message Template` (and `System Message` if applicable) is first processed by Nunjucks. This means all `{% ... %}` tags and `{{ ... }}` placeholders are evaluated by Nunjucks using the provided arguments and special context variables (like `{{previous_message}}`, `{{tools_available}}`).
2.  **Text Reference Expansion:** After Nunjucks has processed the template, the system then handles text reference expansion. If an argument's value was a long string that got converted to a `ref:xyz` placeholder by the `TextReferenceManager` (this happens before Nunjucks), Nunjucks will render `{{my_long_arg}}` to its `ref:xyz` value. Then, the existing reference replacement logic will swap `ref:xyz` with the actual long content.

This two-step process ensures that Nunjucks logic operates on the argument values (or their reference IDs) and then the full text is assembled.

### Examples:

#### Conditional Logic:

You can conditionally include text based on an argument:

```nunjucks
{% if user_name %}
Hello, {{user_name}}! Thanks for providing your name.
{% else %}
Hello there!
{% endif %}

{% if task_details == "urgent" %}
This is an URGENT task.
{% endif %}
```

This is particularly useful for optional arguments.

#### Simple Loops:

If you have an argument that is a list (e.g., a JSON array passed as a string argument, which you might need to parse or ensure your Nunjucks context can handle as an iterable), you can loop through it:

```nunjucks
Please summarize the following points:
{% for point in points_list %}
- {{ point }}
{% endfor %}
```

_(Note: For complex data types like lists passed as arguments, ensure they are correctly formatted and accessible within the Nunjucks context. Simple string arguments are directly available. For lists or objects, you might need to ensure they are passed as actual iterables/objects to Nunjucks if your setup supports it, or use Nunjucks filters to parse them if they are strings.)_

### Using Standard Placeholders:

Simple variable replacement still works as you'd expect:

```nunjucks
Your topic is: {{topic}}.
```

Nunjucks handles these standard placeholders.

### Advanced Nunjucks Features:

Beyond basic conditionals and loops, Nunjucks offers several advanced features to make your prompt templates even more modular and powerful:

- **Macros (`{% macro %}`):** Define reusable chunks of template logic. This is great for standardizing parts of prompts or complex formatting.

  ```nunjucks
  {% macro user_card(user) %}
  User Details:
  Name: {{ user.name | default("N/A") }}
  Email: {{ user.email | default("N/A") }}
  {% if user.is_admin %}Admin User{% endif %}
  {% endmacro %}

  --- User 1 ---
  {{ user_card(user1_data) }}
  --- User 2 ---
  {{ user_card(user2_data) }}
  ```

- **Template Inheritance (`{% extends %}`, `{% block %}`):** Create a base prompt template and then have other prompts extend it, overriding specific blocks. This requires Nunjucks to be configured with a file system loader (see Phase 3, Task 2 in the integration plan).

  - `base_prompt.njk` (or `.md` if your loader is configured for it):
    ```nunjucks
    System: You are a helpful assistant.
    User: {% block user_query %}Default user query.{% endblock %}
    Context: {{ previous_message }}
    ```
  - `specific_task.njk`:
    `nunjucks
    {% extends "base_prompt.njk" %}
    {% block user_query %}Please tell me about {{ topic }}.{% endblock %}
    `
    _(Note: The exact paths for `extends` will depend on how the Nunjucks file loader is configured.)_

- **Filters (`|`):** Nunjucks provides many built-in filters (e.g., `lower`, `upper`, `length`, `join`, `default`, `sum`, `sort`) and allows for custom global filters to be added in the Nunjucks environment setup.

  ```nunjucks
  Topic: {{ topic_name | upper }}
  Item count: {{ item_list | length }}
  Backup: {{ backup_contact | default("admin@example.com") }}
  ```

- **Setting Variables (`{% set %}`):** You can define variables directly within your template for temporary use.
  ```nunjucks
  {% set task_priority = "High" %}
  {% if user_level > 4 %}
    {% set task_priority = "Critical" %}
  {% endif %}
  Current task priority: {{ task_priority }}
  ```

For a comprehensive list of tags and filters, refer to the [official Nunjucks documentation](https://mozilla.github.io/nunjucks/templating.html).

---

Each prompt in the `prompts` array has:

## Working with Prompts

### Adding a New Prompt to an Existing Category

1. Create a new markdown file in the appropriate category folder (e.g., `prompts/general/my_prompt.md`)
2. Add the prompt template to the file using markdown format
3. Register the prompt in the category's prompts.json file (e.g., `prompts/general/prompts.json`)

### Creating a New Category

1. Create a new folder in the `prompts` directory for your category (e.g., `prompts/mycategory/`)
2. Create a `prompts.json` file in the new category folder with the following structure:
   ```json
   {
     "prompts": []
   }
   ```
3. Add your category to the `categories` array in `promptsConfig.json`
4. Add the path to your category's prompts.json file to the `imports` array in `promptsConfig.json`

## Programmatic Management Tools

The MCP server provides tools for programmatically managing prompts:

1. `create_category` - Creates a new prompt category
2. `update_prompt` - Creates or updates a prompt
3. `delete_prompt` - Deletes a prompt

These tools allow you to manage your prompts without having to manually edit the configuration files.

### Creating a Category

Use the `create_category` tool to create a new category:

```javascript
// Example: Creating a new category
const response = await fetch(
  "http://localhost:9090/api/v1/tools/create_category",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: "my_category",
      name: "My Category",
      description: "A category for my custom prompts",
    }),
  }
);

const result = await response.json();
console.log(result);
```

#### Parameters

- `id` (string, required) - Unique identifier for the category
- `name` (string, required) - Display name for the category
- `description` (string, required) - Description of the category

### Creating or Updating a Prompt

Use the `update_prompt` tool to create a new prompt or update an existing one:

```javascript
// Example: Creating a new prompt
const response = await fetch(
  "http://localhost:9090/api/v1/tools/update_prompt",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: "my_prompt",
      name: "My Prompt",
      category: "my_category",
      description: "A custom prompt for my use case",
      systemMessage: "You are a helpful assistant.",
      userMessageTemplate: "Hello {{name}}, please help me with {{task}}.",
      arguments: [
        {
          name: "name",
          description: "The name to greet",
          required: true,
        },
        {
          name: "task",
          description: "The task to help with",
          required: true,
        },
      ],
    }),
  }
);

const result = await response.json();
console.log(result);
```

#### Parameters

- `id` (string, required) - Unique identifier for the prompt
- `name` (string, required) - Display name for the prompt
- `category` (string, required) - Category this prompt belongs to (must exist)
- `description` (string, required) - Description of the prompt
- `systemMessage` (string, optional) - System message for the prompt
- `userMessageTemplate` (string, required) - Template for generating the user message
- `arguments` (array, required) - Arguments accepted by this prompt
  - `name` (string, required) - Name of the argument
  - `description` (string, optional) - Description of the argument
  - `required` (boolean, required) - Whether this argument is required
- `isChain` (boolean, optional) - Whether this prompt is a chain of prompts
- `chainSteps` (array, optional) - Steps in the chain if this is a chain prompt
  - `promptId` (string, required) - ID of the prompt to execute in this step
  - `stepName` (string, required) - Name of this step
  - `inputMapping` (object, optional) - Maps chain inputs to this step's inputs
  - `outputMapping` (object, optional) - Maps this step's outputs to chain outputs

### Creating a Chain Prompt

Chain prompts allow you to create a sequence of prompts that are executed in order. Each step in the chain can use the outputs of previous steps as inputs.

```javascript
// Example: Creating a chain prompt
const response = await fetch(
  "http://localhost:9090/api/v1/tools/update_prompt",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: "my_chain_prompt",
      name: "My Chain Prompt",
      category: "my_category",
      description: "A chain prompt that processes data in multiple steps",
      userMessageTemplate: "Process the following data: {{data}}",
      arguments: [
        {
          name: "data",
          description: "The data to process",
          required: true,
        },
      ],
      isChain: true,
      chainSteps: [
        {
          promptId: "step1_prompt",
          stepName: "Step 1: Analyze Data",
          inputMapping: {
            input_data: "data",
          },
          outputMapping: {
            analysis_result: "step1_result",
          },
        },
        {
          promptId: "step2_prompt",
          stepName: "Step 2: Generate Recommendations",
          inputMapping: {
            analysis: "step1_result",
          },
          outputMapping: {
            recommendations: "final_recommendations",
          },
        },
      ],
    }),
  }
);

const result = await response.json();
console.log(result);
```

## File Structure

When you create a prompt using the `update_prompt` tool, the following happens:

1. A new entry is added to the appropriate category's prompts.json file
2. A new markdown file is created in the corresponding category directory (e.g., `prompts/my_category/my_prompt.md`)

The markdown file follows this structure:

```markdown
# Prompt Name

## Description

Prompt description

## System Message

System message content

## User Message Template

User message template content

## Chain Steps (only for chain prompts)

1. promptId: prompt_id
   stepName: Step Name
   inputMapping:
   chain_input: step_input
   outputMapping:
   step_output: chain_output
```

## Error Handling

Both tools return a JSON response with the following structure:

- Success:

  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Success message"
      }
    ]
  }
  ```

- Error:
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "Error message"
      }
    ],
    "isError": true
  }
  ```
