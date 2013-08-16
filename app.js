function StateController($scope) {
  $scope.all_registers = all_registers;
  $scope.state = new State();
  $scope.range = range;
  $scope.hex = hex;
  $scope.flag_descriptions = flag_descriptions;
}

var mod = angular.module('x86interpreter', ['ui.bootstrap']);
mod.factory('$exceptionHandler', function () {
  return function (exception, cause) {
    alert(exception);
  };
});
mod.directive('focusOn', function() {
  return function(scope, element, attrs) {
    scope.$watch(attrs.focusOn, function (condition) {
      if (condition) {
        element[0].focus();
      }
    });
  }
});
mod.directive('integer', function(){
  return {
    require: 'ngModel',
  link: function(scope, ele, attr, ctrl){
    ctrl.$parsers.unshift(function(viewValue) {
      if (viewValue == "0x" || viewValue == "0X") {
        return 0;
      }
      return parseInt(viewValue);
    });
    ctrl.$formatters.push(hex);
  }
  };
});
mod.directive('ngEnter', function () {
  return function (scope, element, attrs) {
    element.bind("keydown keypress", function (event) {
      if(event.which === 13) {
        scope.$apply(function (){
          scope.$eval(attrs.ngEnter);
        });
        event.preventDefault();
      }
    });
  };
});
