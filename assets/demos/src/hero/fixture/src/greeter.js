// Formats a greeting for the sign-in banner.
export function greet(name) {
  return "Hello, " + name;
}

export function greetAll(names) {
  return names.map(greet).join("\n");
}
