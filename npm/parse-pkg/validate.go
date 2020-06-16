package parsepkg

import (
	"net/url"
	"regexp"
	"strings"
)

var scopedPackagePattern *regexp.Regexp
var unsafePackageNames = []string{
	"node_modules",
	"favicon.ico",
}

func init() {
	scopedPackagePattern = regexp.MustCompile("^(?:@([^/]+?)[/])?([^/]+?)$")
}

type ValidationResult struct {
	ValidForNewPackages bool
	ValidForOldPackages bool
	Warnings            []string
	Errors              []string
}

// validate-npm-package-name
func Validate(name string) ValidationResult {
	warnings := []string{}
	errors := []string{}

	if name == "" {
		errors = append(errors, "name length must be greater than zero")
		return buildResult(warnings, errors)
	}
	if match, err := regexp.MatchString("^\\.", name); err == nil && match {
		errors = append(errors, "name cannot start with a period")
	}
	if match, err := regexp.MatchString("^_", name); err == nil && match {
		errors = append(errors, "name cannot start with an underscore")
	}
	if strings.TrimSpace(name) != name {
		errors = append(errors, "name cannot contain leading or trailing spaces")
	}

	lowerName := strings.ToLower(name)
	for _, unsafeName := range unsafePackageNames {
		if lowerName == unsafeName {
			errors = append(errors, unsafeName+" is an unsafe name")
		}
	}

	for _, builtin := range nodeBuiltins {
		if lowerName == builtin {
			warnings = append(warnings, builtin+" is a core module name")
		}
	}

	if len(name) > 214 {
		warnings = append(warnings, "name can no longer contain more than 214 characters")
	}

	if lowerName != name {
		warnings = append(warnings, "name can no longer contain capital letters")
	}

	pkgNoAuthor := getPkgNoAuthor(name)
	if match, err := regexp.MatchString("[~'!()*]", pkgNoAuthor); err == nil && match {
		warnings = append(warnings, "name can no longer contain special characters (\"~\\'!()*\")")
	}

	if !isURLFriendly(name) {
		errors = append(errors, "name can only contain URL-friendly characters")
	}

	return buildResult(warnings, errors)
}

func buildResult(warnings, errors []string) ValidationResult {
	var result ValidationResult
	if len(errors) == 0 && len(warnings) == 0 {
		result.ValidForNewPackages = true
	}
	if len(errors) == 0 {
		result.ValidForOldPackages = true
	}
	if len(errors) > 0 {
		result.Errors = errors
	}
	if len(warnings) > 0 {
		result.Warnings = warnings
	}
	return result
}

func getPkgNoAuthor(name string) string {
	split := strings.Split(name, "/")
	if len(split) < 1 {
		return ""
	}
	return split[len(split)-1]
}

func isURLFriendly(name string) bool {
	if escape(name) != name {
		// Maybe it's a scoped package name, like @user/package
		nameMatch := scopedPackagePattern.FindAllStringSubmatch(name, -1)
		if nameMatch != nil && len(nameMatch[0]) > 1 {
			user := nameMatch[0][1]
			pkg := nameMatch[0][2]
			return escape(user) == user && escape(pkg) == pkg
		}
		return false
	}
	return true
}

func escape(str string) string {
	resultStr := url.QueryEscape(str)
	resultStr = strings.Replace(resultStr, "+", "%20", -1)
	resultStr = strings.Replace(resultStr, "%21", "!", -1)
	resultStr = strings.Replace(resultStr, "%27", "'", -1)
	resultStr = strings.Replace(resultStr, "%28", "(", -1)
	resultStr = strings.Replace(resultStr, "%29", ")", -1)
	resultStr = strings.Replace(resultStr, "%2A", "*", -1)
	return resultStr
}
