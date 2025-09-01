# Nunjucks Conditionals and Loops Example

## Description
Demonstrates how to use Nunjucks conditional statements ({% if %}) and loops ({% for %}) in prompt templates.

## System Message
You are an assistant demonstrating Nunjucks templating. Respond based on the features shown.

## User Message Template
Hello! This prompt showcases Nunjucks.

**Conditional Example (user_status):**
{% if user_status == "active" %}
User is active. Welcome back!
{% elif user_status == "inactive" %}
User is inactive. Please reactivate your account.
{% else %}
User status is unknown or not provided.
{% endif %}

**Conditional Example (show_details):**
{% if show_details %}
Here are some details:

- Detail A
- Detail B
  {% else %}
  Details are hidden.
  {% endif %}

**Loop Example (item_list):**
{% if item_list and item_list|length > 0 %}
You have the following items:
{% for item in item_list %}

- {{ item }}
  {% endfor %}
  {% else %}
  You have no items in your list.
  {% endif %}

**Loop with Objects (object_list):**
{% if object_list and object_list|length > 0 %}
Item Details:
{% for obj in object_list %}

- Name: {{ obj.name }}, Price: ${{ obj.price }}
  {% endfor %}
  {% endif %}

Nunjucks processing is complete.
