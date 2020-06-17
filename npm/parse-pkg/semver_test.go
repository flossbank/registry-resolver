package parsepkg_test

import (
	"fmt"
	"math"
	"strings"
	"testing"

	"github.com/flossbank/registry-resolver/npm/parsepkg"
)

func TestIsValidSemver(t *testing.T) {
	var bigStringArr [parsepkg.SemverMaxLength]string
	testCases := []struct {
		input    string
		expected bool
	}{
		{input: "1.2.3", expected: true},
		{input: "4.5.6", expected: true},
		{input: "4.5.6", expected: true},
		{input: "4.2.0foo", expected: true},
		{input: fmt.Sprintf("%s.0.0", strings.Join(bigStringArr[:], "1")), expected: false},
		{input: fmt.Sprintf("%d0.0.0", math.MaxUint32), expected: false},
		{input: fmt.Sprintf("0.%d0.0", math.MaxUint32), expected: false},
		{input: fmt.Sprintf("0.0.%d0", math.MaxUint32), expected: false},
		{input: "hello, world", expected: false},
		{input: "xyz", expected: false},
	}
	for _, testCase := range testCases {
		actual := parsepkg.IsValidSemver(testCase.input)
		if actual != testCase.expected {
			t.Errorf("for %s wanted %v but got %v", testCase.input, testCase.expected, actual)
		}
	}
}
