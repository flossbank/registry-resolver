# registry-resolver

A packages resolver library intended to craft a "weights map" for the entire dependency tree of a given package or packages.

# Usage

Given an epsilon, registry-resolver can be used to craft a dependency tree map where the key is a versioned package name, and the value is the "weight" of that package within the entire tree. 

The "mass" of each weights map will always sum to 1 for each execution of the registry resolver.

# API

A new instance of the registry resolver can be created with a single map argument with keys of "epsilon" and "log". 

Epsilon represents the smallest weight that will be assigned to a package before exiting. This is a float and we use 0.00001
Log is an argument that defaults to the console, but a custom logger may be passed in.

See example usage [here](https://github.com/flossbank/distribute-org-donations/blob/production/index.js#L3)

# License 
GPL-3.0