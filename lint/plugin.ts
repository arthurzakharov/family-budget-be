/**
 * Local oxlint rules for this repository.
 * Loaded via `jsPlugins` in `.oxlintrc.json`.
 */
import { definePlugin, defineRule, type ESTree } from "@oxlint/plugins";

type ClassMember =
  | ESTree.PropertyDefinition
  | ESTree.MethodDefinition
  | ESTree.AccessorProperty
  | ESTree.TSParameterProperty;

const MESSAGE =
  "Use a `#private` member instead of the TypeScript `private` modifier, which is only enforced at compile time.";

/** Forbids the TypeScript `private` modifier on class members. */
const noTsPrivate = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require `#private` instead of `private`" },
  },
  create(context) {
    const check = (node: ClassMember): void => {
      if (node.accessibility === "private") {
        context.report({ node, message: MESSAGE });
      }
    };
    return {
      PropertyDefinition: check,
      MethodDefinition: check,
      AccessorProperty: check,
      TSParameterProperty: check,
    };
  },
});

export default definePlugin({
  meta: { name: "local" },
  rules: { "no-ts-private": noTsPrivate },
});
