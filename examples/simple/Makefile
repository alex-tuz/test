
#
# we add `-c make` to duo-test(1)
# because we want duo to run `make`
# on refresh
#

T= ../../bin/duo-test -c make -R dot

build.js: test/test.js
	@duo $< > build.js

test-browser:
	@$(T) browser

test-phantomjs:
	@$(T) phantomjs

test-saucelabs:
	@$(T) -b safari:5..7 saucelabs

.PHONY: test test-saucelabs test-phantomjs
