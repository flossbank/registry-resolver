package parsepkg_test

import (
	"testing"

	"github.com/flossbank/registry-resolver/npm/parsepkg"
)

type validationTestCase struct {
	input    string
	expected parsepkg.ValidationResult
}

func assertEqual(t *testing.T, input string, actual, expected parsepkg.ValidationResult) {
	if actual.ValidForNewPackages != expected.ValidForNewPackages {
		t.Errorf("for input %s, wanted valid for new: %v, got %v", input, expected.ValidForNewPackages, actual.ValidForNewPackages)
	}
	if actual.ValidForOldPackages != expected.ValidForOldPackages {
		t.Errorf("for input %s, wanted valid for old: %v, got %v", input, expected.ValidForOldPackages, actual.ValidForOldPackages)
	}

	if len(actual.Errors) != len(expected.Errors) {
		t.Fatalf("for input %s, wanted %d errors but got %d", input, len(expected.Errors), len(actual.Errors))
	}

	if len(actual.Warnings) != len(expected.Warnings) {
		t.Fatalf("for input %s, wanted %d warnings but got %d", input, len(expected.Warnings), len(actual.Warnings))
	}

	for i, e := range expected.Errors {
		if actual.Errors[i] != e {
			t.Errorf("for input %s, wanted error \"%s\" but got \"%s\"", input, e, actual.Errors[i])
		}
	}

	for i, w := range expected.Warnings {
		if actual.Warnings[i] != w {
			t.Errorf("for input %s, wanted warning \"%s\" but got \"%s\"", input, w, actual.Warnings[i])
		}
	}
}

func TestValidate(t *testing.T) {
	var testCases = []validationTestCase{
		// Traditional
		{
			input: "some-package",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: true,
				ValidForOldPackages: true,
			},
		},
		{
			input: "example.com",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: true,
				ValidForOldPackages: true,
			},
		},
		{
			input: "under_score",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: true,
				ValidForOldPackages: true,
			},
		},
		{
			input: "period.js",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: true,
				ValidForOldPackages: true,
			},
		},
		{
			input: "123numeric",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: true,
				ValidForOldPackages: true,
			},
		},
		{
			input: "crazy!",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: true,
				Warnings: []string{
					"name can no longer contain special characters (\"~\\'!()*\")",
				},
			},
		},

		// Scoped (npm 2+)
		{
			input: "@npm/thingy",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: true,
				ValidForOldPackages: true,
			},
		},
		{
			input: "@npm-zors/money!time.js",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: true,
				Warnings: []string{
					"name can no longer contain special characters (\"~\\'!()*\")",
				},
			},
		},

		// Invalid
		{
			input: "",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: false,
				Errors: []string{
					"name length must be greater than zero",
				},
			},
		},
		{
			input: ".start-with-period",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: false,
				Errors: []string{
					"name cannot start with a period",
				},
			},
		},
		{
			input: "_start-with-underscore",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: false,
				Errors: []string{
					"name cannot start with an underscore",
				},
			},
		},
		{
			input: "contain:colons",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: false,
				Errors: []string{
					"name can only contain URL-friendly characters",
				},
			},
		},
		{
			input: " leading-space",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: false,
				Errors: []string{
					"name cannot contain leading or trailing spaces",
					"name can only contain URL-friendly characters",
				},
			},
		},
		{
			input: "trailing-space ",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: false,
				Errors: []string{
					"name cannot contain leading or trailing spaces",
					"name can only contain URL-friendly characters",
				},
			},
		},
		{
			input: "s/l/a/s/h/e/s",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: false,
				Errors: []string{
					"name can only contain URL-friendly characters",
				},
			},
		},
		{
			input: "node_modules",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: false,
				Errors: []string{
					"node_modules is an unsafe name",
				},
			},
		},
		{
			input: "favicon.ico",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: false,
				Errors: []string{
					"favicon.ico is an unsafe name",
				},
			},
		},

		// Node
		{
			input: "http",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: true,
				Warnings: []string{
					"http is a core module name",
				},
			},
		},

		// Long
		{
			input: "ifyouwanttogetthesumoftwonumberswherethosetwonumbersarechosenbyfindingthelargestoftwooutofthreenumbersandsquaringthemwhichismultiplyingthembyitselfthenyoushouldinputthreenumbersintothisfunctionanditwilldothatforyou-",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: true,
				Warnings: []string{
					"name can no longer contain more than 214 characters",
				},
			},
		},
		{
			input: "ifyouwanttogetthesumoftwonumberswherethosetwonumbersarechosenbyfindingthelargestoftwooutofthreenumbersandsquaringthemwhichismultiplyingthembyitselfthenyoushouldinputthreenumbersintothisfunctionanditwilldothatforyou",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: true,
				ValidForOldPackages: true,
			},
		},

		// Legacy mixed case
		{
			input: "CAPITAL-LETTERS",
			expected: parsepkg.ValidationResult{
				ValidForNewPackages: false,
				ValidForOldPackages: true,
				Warnings: []string{
					"name can no longer contain capital letters",
				},
			},
		},
	}

	for _, testCase := range testCases {
		actual := parsepkg.Validate(testCase.input)
		assertEqual(t, testCase.input, actual, testCase.expected)
	}
}
