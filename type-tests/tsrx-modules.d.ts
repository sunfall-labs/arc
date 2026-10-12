// The type tests compile with plain tsgo, which cannot read `.tsrx` sources;
// example modules they reach (through generated lazy route components) import
// tsrx components.
declare module "*.tsrx";
